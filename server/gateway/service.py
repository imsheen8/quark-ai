"""منطق البوابة: تنفيذ المحادثة والتوليد وجلب النماذج فوق الصيغ الأصلية للمزوّدين."""
from __future__ import annotations

import base64
import json
import re
import time
import urllib.request
from typing import Dict, Iterator, List, Optional

from . import discovery, rules
from .dialects import REGISTRY, Adjust, ChatRequest, parse_messages
from .dialects.base import Msg, event
from .dialects.gemini_native import GeminiNative
from .dialects.ollama_native import api_root, default_ctx_cap
from .errors import GatewayError, extract_detail, from_exception
from .providers import EndpointError, Endpoint, resolve_endpoint
from .thinking import ThinkSplitter
from .transport import Cancel, iter_lines, open_request, read_json, ssl_context, USER_AGENT

_PARAM_LIMITS = {"temperature": (0.0, 2.0), "top_p": (0.0, 1.0)}
_REPAIRS = (
    ("stream_options", ("stream_options",)),
    ("temperature", ("temperature",)),
    ("top_p", ("top_p",)),
    ("num_ctx", ("num_ctx",)),
    ("thinking", ("thinking", "reasoning", "think", "budget_tokens", "chat_template_kwargs", "enable_thinking")),
)
_ctx_cache: Dict[str, Optional[int]] = {}


# ------------------------------------------------------------------ بناء الطلب
def build_request(body: dict, stream: bool = True) -> ChatRequest:
    try:
        ep = resolve_endpoint(body.get("endpoint"))
    except EndpointError as e:
        raise GatewayError(str(e), 400, "bad_endpoint")
    model = str(body.get("model") or "").strip()
    if not model:
        raise GatewayError("لم يُحدَّد نموذج.", 400, "bad_request")
    params: Dict[str, float] = {}
    raw = body.get("params") if isinstance(body.get("params"), dict) else {}
    for k, (lo, hi) in _PARAM_LIMITS.items():
        v = rules.clamp(raw.get(k), lo, hi)
        if v is not None:
            params[k] = v
    mt = rules.clamp(raw.get("max_tokens"), 1, 2_000_000)
    if mt is not None:
        params["max_tokens"] = int(mt)
    opts = body.get("options") if isinstance(body.get("options"), dict) else {}
    thinking = str(opts.get("thinking") or "auto").lower()
    return ChatRequest(ep=ep, model=model, system=str(body.get("system") or ""),
                       messages=parse_messages(body.get("messages")), params=params,
                       thinking=thinking if thinking in ("on", "off") else "auto", stream=stream)


# ------------------------------------------------------- الإصلاح التلقائي للطلب
def _repair(adj: Adjust, status: Optional[int], raw: bytes, err: GatewayError) -> bool:
    """يقرأ سبب الرفض ويعدّل الطلب (حذف حقل/تبديل اسم حقل). يعيد True إن تغيّر شيء يستحق إعادة المحاولة."""
    if status not in (400, 404, 422):
        return False
    t = (extract_detail(raw) + " " + raw.decode("utf-8", "replace")[:800]).lower()
    changed = False
    if "max_tokens" in adj.used and "max_completion_tokens" in t:
        want = "max_tokens" if adj.token_key == "max_completion_tokens" else "max_completion_tokens"
        if adj.token_key != want:
            adj.token_key, changed = want, True
    for feature, words in _REPAIRS:
        if feature in adj.used and feature not in adj.skip and any(w in t for w in words):
            adj.skip.add(feature)
            changed = True
    return changed


def _stream_unsupported(raw: bytes) -> bool:
    t = raw.decode("utf-8", "replace").lower()
    return "stream" in t and any(w in t for w in ("verified", "not supported", "unsupported", "does not support"))


def _ollama_ctx(req: ChatRequest) -> Optional[int]:
    """نافذة سياق Ollama الافتراضية صغيرة وتقتطع المحادثات الطويلة بصمت؛ نرفعها لما يعلنه النموذج (بسقف)."""
    key = req.ep.url + "|" + req.model
    if key not in _ctx_cache:
        ctx = None
        try:
            d = REGISTRY["ollama"]
            info = read_json(open_request(req.ep, api_root(req.ep) + "/show", d.headers(req.ep), {"model": req.model}, timeout=5, retries=0))
            for k, v in (info.get("model_info") or {}).items():
                if k.endswith(".context_length") and isinstance(v, int):
                    ctx = v
                    break
        except Exception:
            ctx = None
        _ctx_cache[key] = ctx
    ctx = _ctx_cache[key]
    return min(ctx, default_ctx_cap()) if ctx else None


def _empty_reason(finish: str) -> str:
    f = (finish or "").lower()
    if f in ("length", "max_tokens", "max_output_tokens"):
        return "توقف النموذج لأنه بلغ الحد الأقصى للرموز قبل أن يُنتج إجابة. زِد قيمة Max Tokens من إعدادات النموذج."
    if f in ("content_filter", "safety", "refusal", "blocked", "prohibited_content", "recitation"):
        return "امتنع النموذج عن الرد لأسباب تتعلق بسياسات المحتوى."
    return "لم يصل أي رد من النموذج. تأكد من صحة معرّف النموذج ومن أن النقطة تدعم المحادثة."


# --------------------------------------------------------------- المحادثة (بث)
def run_chat(req: ChatRequest, cancel: Optional[Cancel] = None) -> Iterator[dict]:
    """يُنتج أحداثًا موحّدة: meta / text / think / usage / finish / error / done."""
    ep = req.ep
    dialect = REGISTRY[ep.dialect]
    adj = Adjust()
    yield event("meta", provider=ep.provider, label=ep.label, dialect=ep.dialect)
    try:
        if ep.dialect == "ollama":
            req.num_ctx = _ollama_ctx(req)
        stream, resp = req.stream, None
        for attempt in range(4):
            req.stream = stream
            payload = dialect.build(req, adj)
            try:
                resp = open_request(ep, dialect.chat_url(ep, req.model, stream), dialect.headers(ep), payload, cancel=cancel)
                break
            except GatewayError as e:
                raw = getattr(e, "raw_body", b"") or b""
                if attempt < 3 and _repair(adj, e.status, raw, e):
                    continue
                if attempt < 3 and stream and e.status in (400, 403, 422) and _stream_unsupported(raw):
                    stream = False
                    continue
                raise
        events = dialect.stream_events(iter_lines(resp, cancel), req) if stream else dialect.once_events(read_json(resp), req)
        splitter, produced, finish = ThinkSplitter(), False, ""
        for ev in events:
            kind = ev.get("t")
            if kind == "text":
                for k, txt in splitter.feed(ev["d"]):
                    produced = True
                    yield event(k, d=txt)
            elif kind == "think":
                produced = True
                yield ev
            else:
                if kind == "finish":
                    finish = ev.get("reason", "")
                yield ev
        for k, txt in splitter.flush():
            produced = True
            yield event(k, d=txt)
        if not produced:
            raise GatewayError(_empty_reason(finish), None, "empty")
        yield event("done")
    except GatewayError as e:
        if e.code != "cancelled":
            yield event("error", msg=e.message, status=e.status, code=e.code)
    except Exception as e:                                   # أي شيء غير متوقع لا يجب أن يُسقط الخادم
        if not (cancel and cancel.cancelled):
            g = from_exception(e, ep)
            yield event("error", msg=g.message, status=g.status, code=g.code)


def run_once(req: ChatRequest) -> dict:
    """طلب غير متدفق (عنوان تلقائي، اختبار اتصال…)."""
    req.stream = False
    t0 = time.time()
    text, think, usage, meta, err = [], [], {}, {}, None
    for ev in run_chat(req):
        k = ev.get("t")
        if k == "text":
            text.append(ev["d"])
        elif k == "think":
            think.append(ev["d"])
        elif k == "usage":
            usage = ev
        elif k == "meta":
            meta = ev
        elif k == "error":
            err = ev
    ms = int((time.time() - t0) * 1000)
    if err:
        return {"ok": False, "error": err["msg"], "status": err.get("status"), "code": err.get("code"), "ms": ms}
    return {"ok": True, "text": "".join(text), "think": "".join(think), "usage": usage, "ms": ms,
            "provider": meta.get("provider"), "label": meta.get("label"), "dialect": meta.get("dialect")}


# ------------------------------------------------------------------- توليد الصور
_IMG_API_NAME = re.compile(r"(dall-e|gpt-image|flux|stable-diffusion|sdxl|seedream|ideogram|recraft)", re.I)


def _inline_image(ep: Endpoint, url: str) -> dict:
    """ينزّل صورة أعادها المزوّد كرابط ويحوّلها لـ data URL لتجنّب قيود CORS في المتصفح."""
    if url.startswith("data:"):
        return {"data": url}
    if not url.startswith("https://"):
        return {"url": url}
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=40, context=ssl_context())
        blob = r.read(14 * 1024 * 1024 + 1)
        if len(blob) > 14 * 1024 * 1024:
            return {"url": url}
        mime = (r.headers.get_content_type() or "image/png") if r.headers else "image/png"
        return {"data": "data:%s;base64,%s" % (mime if mime.startswith("image/") else "image/png", base64.b64encode(blob).decode())}
    except Exception:
        return {"url": url}


def _images_openai_chat(req: ChatRequest, image_only: bool) -> dict:
    ep, d = req.ep, REGISTRY["openai"]
    payload = d.build(req, Adjust())
    payload.pop("stream_options", None)
    order = ([["image"], ["image", "text"]] if image_only else [["image", "text"], ["image"]])
    last: Optional[GatewayError] = None
    for mods in order:
        payload.update({"modalities": mods, "stream": False})
        try:
            data = read_json(open_request(ep, d.chat_url(ep, req.model, False), d.headers(ep), payload))
            break
        except GatewayError as e:
            last = e
            if e.status not in (400, 404, 422):
                raise
    else:
        raise last or GatewayError("فشل توليد الصورة", None, "image")
    msg = ((data.get("choices") or [{}])[0] or {}).get("message") or {}
    urls: List[str] = []
    for x in msg.get("images") or []:
        u = (x.get("image_url") or {}).get("url") if isinstance(x, dict) else None
        u = u or (x.get("url") if isinstance(x, dict) else None)
        if isinstance(u, str) and u:
            urls.append(u)
    text = ""
    c = msg.get("content")
    if isinstance(c, list):
        for p in c:
            if isinstance(p, dict) and p.get("type") == "image_url" and (p.get("image_url") or {}).get("url"):
                urls.append(p["image_url"]["url"])
        text = "\n".join(str(p.get("text") or "") for p in c if isinstance(p, dict) and p.get("type") == "text")
    elif isinstance(c, str):
        text = c
    return {"text": text, "images": urls}


def _images_openai_api(req: ChatRequest) -> dict:
    ep, d = req.ep, REGISTRY["openai"]
    prompt = next((m.content for m in reversed(req.messages) if m.role == "user" and m.content), "")
    if not prompt:
        raise GatewayError("اكتب وصفًا للصورة أولًا.", 400, "bad_request")
    data = read_json(open_request(ep, ep.url + "/images/generations", d.headers(ep), {"model": req.model, "prompt": prompt, "n": 1}))
    urls = []
    for it in data.get("data") or []:
        if it.get("b64_json"):
            urls.append("data:image/png;base64," + it["b64_json"])
        elif it.get("url"):
            urls.append(it["url"])
    return {"text": "", "images": urls}


def _images_gemini(req: ChatRequest) -> dict:
    ep, g = req.ep, GeminiNative()
    payload = g.build(req, Adjust(), image_output=True)
    data = read_json(open_request(ep, g.chat_url(ep, req.model, False), g.headers(ep), payload))
    text, imgs = [], []
    for ev in g.once_events(data, req):
        if ev["t"] == "text":
            text.append(ev["d"])
        elif ev["t"] == "image":
            imgs.append("data:%s;base64,%s" % (ev["mime"], ev["data"]))
    return {"text": "".join(text), "images": imgs}


def run_image(body: dict) -> dict:
    req = build_request(body, stream=False)
    ep = req.ep
    try:
        if ep.dialect == "anthropic":
            raise GatewayError("Anthropic لا تدعم توليد الصور. اختر نموذجًا آخر (مثل OpenRouter أو Gemini).", 400, "unsupported")
        if ep.dialect == "ollama":
            raise GatewayError("Ollama لا تدعم توليد الصور بعد.", 400, "unsupported")
        if ep.dialect == "gemini":
            out = _images_gemini(req)
        elif _IMG_API_NAME.search(req.model) and ep.provider != "openrouter":
            try:
                out = _images_openai_api(req)
            except GatewayError as e:
                if e.status not in (404, 405):
                    raise
                out = _images_openai_chat(req, True)
        else:
            out = _images_openai_chat(req, bool((body.get("options") or {}).get("imageOnly")))
        if not out["images"]:
            hint = out["text"].strip()[:300]
            raise GatewayError("لم يُنتج النموذج أي صورة." + (" ردّه: " + hint if hint else " تأكد أنه يدعم توليد الصور."), None, "no_image")
        return {"ok": True, "text": out["text"], "images": [_inline_image(ep, u) for u in out["images"]]}
    except GatewayError as e:
        return {"ok": False, "error": e.message, "status": e.status, "code": e.code}
    except Exception as e:
        g = from_exception(e, ep)
        return {"ok": False, "error": g.message, "status": g.status, "code": g.code}


# --------------------------------------------------------------------- النماذج
def run_models(body: dict) -> dict:
    try:
        ep = resolve_endpoint(body.get("endpoint"))
    except EndpointError as e:
        return {"ok": False, "error": str(e), "code": "bad_endpoint"}
    try:
        return discovery.list_models(ep)
    except GatewayError as e:
        return {"ok": False, "error": e.message, "status": e.status, "code": e.code}
    except Exception as e:
        g = from_exception(e, ep)
        return {"ok": False, "error": g.message, "status": g.status, "code": g.code}
