"""
اكتشاف النماذج المتاحة لكل نقطة اتصال بحسب لغتها الأصلية، مع تصنيفها
(محادثة / صور / تضمين / صوت …) وقراءة ما يصرّح به المزوّد من قدرات ونافذة سياق.
"""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional
from urllib.parse import urlparse, urlunparse

from .dialects import REGISTRY
from .dialects.ollama_native import api_root
from .errors import GatewayError
from .providers import Endpoint
from .transport import open_request, read_json

_KIND_RULES = (
    ("embedding", re.compile(r"(embed|(^|[/_-])(bge|gte|e5)[-_]|rerank|nomic-embed)", re.I)),
    ("speech", re.compile(r"(whisper|(^|[/_-])tts|text-to-speech|transcribe|speech|voxtral|orpheus|playai)", re.I)),
    ("moderation", re.compile(r"(moderation|omni-moderation)", re.I)),
    ("video", re.compile(r"(^|[/_-])(veo|sora|kling|runway|hailuo|luma|wan-?\d)", re.I)),
    ("image", re.compile(r"(dall-e|gpt-image|imagen|(^|[/_-])flux|stable-diffusion|sdxl|seedream|ideogram|recraft|nano-banana|[-_]image([-_:.]|$))", re.I)),
)
_TIMEOUT = 25


def classify(model_id: str) -> str:
    for kind, rx in _KIND_RULES:
        if rx.search(model_id or ""):
            return kind
    return "chat"


def _item(mid: str, **kw) -> dict:
    kind = kw.pop("kind", None) or classify(mid)
    out = {"id": mid, "kind": kind}
    if kind == "image":
        out["img"], out["imgOnly"] = True, True
    out.update({k: v for k, v in kw.items() if v not in (None, "", False, 0)})
    return out


def _get(ep: Endpoint, url: str, headers: Dict[str, str], timeout: float = _TIMEOUT) -> dict:
    resp = open_request(ep, url, headers, None, method="GET", timeout=timeout, retries=1)
    return read_json(resp)


# ----------------------------------------------------------------- OpenAI-like
def _openai(ep: Endpoint) -> List[dict]:
    d = REGISTRY["openai"]
    data = _get(ep, ep.url + "/models", d.headers(ep))
    arr = data if isinstance(data, list) else (data.get("data") or data.get("models") or [])
    out: List[dict] = []
    for m in arr:
        if isinstance(m, str):
            out.append(_item(m))
            continue
        if not isinstance(m, dict):
            continue
        mid = m.get("id") or m.get("name") or m.get("model")
        if not isinstance(mid, str) or not mid:
            continue
        mid = mid[7:] if mid.startswith("models/") else mid
        arch = m.get("architecture") if isinstance(m.get("architecture"), dict) else {}
        outm, inm = arch.get("output_modalities") or [], arch.get("input_modalities") or []
        sp = m.get("supported_parameters") or []
        ctx = m.get("context_length") or m.get("context_window") or m.get("max_model_len") or m.get("max_context_length")
        it = _item(mid, name=m.get("display_name") or m.get("name") if m.get("name") != mid else None,
                   ctx=ctx if isinstance(ctx, int) else None,
                   vision=("image" in inm) if inm else None,
                   think=("reasoning" in sp) if sp else None)
        if "image" in outm:
            it["img"] = True
            it["imgOnly"] = "text" not in outm
            if it["imgOnly"]:
                it["kind"] = "image"
        elif outm and it["kind"] == "image":              # المزوّد صرّح بأنه لا يُخرج صورًا
            it["kind"] = "chat"
            it.pop("img", None)
            it.pop("imgOnly", None)
        out.append(it)
    return out


def _fingerprint_local(ep: Endpoint, items: List[dict]) -> Optional[str]:
    """يتعرّف على برنامج الخادم المحلي ويثري القائمة (نافذة السياق، النوع) عند الإمكان."""
    root = ep.origin
    try:                                                          # LM Studio
        j = _get(ep, root + "/api/v0/models", {}, timeout=2.5)
        arr = j.get("data") if isinstance(j, dict) else None
        if isinstance(arr, list) and arr and isinstance(arr[0], dict) and "max_context_length" in arr[0]:
            by_id = {m.get("id"): m for m in arr if isinstance(m, dict)}
            for it in items:
                m = by_id.get(it["id"])
                if not m:
                    continue
                if m.get("max_context_length"):
                    it["ctx"] = m["max_context_length"]
                if m.get("type") == "embeddings":
                    it["kind"] = "embedding"
                elif m.get("type") == "vlm":
                    it["vision"] = True
            return "LM Studio"
    except Exception:
        pass
    try:                                                          # llama.cpp
        j = _get(ep, root + "/props", {}, timeout=2.0)
        if isinstance(j, dict) and ("default_generation_settings" in j or "total_slots" in j):
            n = (j.get("default_generation_settings") or {}).get("n_ctx")
            if n and len(items) == 1:
                items[0]["ctx"] = n
            return "llama.cpp"
    except Exception:
        pass
    try:                                                          # vLLM
        j = _get(ep, root + "/version", {}, timeout=1.5)
        if isinstance(j, dict) and "version" in j and len(j) <= 2:
            return "vLLM"
    except Exception:
        pass
    return None


# ------------------------------------------------------------------- Anthropic
def _anthropic(ep: Endpoint) -> List[dict]:
    d = REGISTRY["anthropic"]
    out: List[dict] = []
    after = ""
    for _ in range(10):
        url = ep.url + "/models?limit=1000" + ("&after_id=" + after if after else "")
        j = _get(ep, url, d.headers(ep))
        for m in j.get("data") or []:
            if isinstance(m, dict) and m.get("id"):
                out.append(_item(m["id"], kind="chat", name=m.get("display_name"), vision=True))
        if not j.get("has_more") or not j.get("last_id"):
            break
        after = j["last_id"]
    return out


# ---------------------------------------------------------------------- Gemini
def _gemini_root(ep: Endpoint) -> str:
    p = urlparse(ep.url)
    path = p.path.rstrip("/")
    if path.endswith("/openai"):
        path = path[: -len("/openai")]
    return urlunparse(p._replace(path=path or "/v1beta", query="", fragment="")).rstrip("/")


def _gemini(ep: Endpoint) -> List[dict]:
    d = REGISTRY["gemini"]
    root = _gemini_root(ep)
    out: List[dict] = []
    token = ""
    for _ in range(20):
        url = root + "/models?pageSize=1000" + ("&pageToken=" + token if token else "")
        j = _get(ep, url, d.headers(ep))
        for m in j.get("models") or []:
            if not isinstance(m, dict):
                continue
            methods = m.get("supportedGenerationMethods") or []
            mid = str(m.get("baseModelId") or m.get("name") or "")
            mid = mid[7:] if mid.startswith("models/") else mid
            if not mid:
                continue
            if "generateContent" not in methods and "streamGenerateContent" not in methods:
                continue                                   # تضمين / predict فقط → ليس محادثة
            kind = classify(mid)
            if kind == "image" and re.search(r"(imagen)", mid, re.I):
                continue                                   # Imagen يستخدم predict لا generateContent
            it = _item(mid, kind=kind if kind in ("image", "embedding", "video", "speech") else "chat",
                       name=m.get("displayName") if m.get("displayName") != mid else None,
                       ctx=m.get("inputTokenLimit"), think=m.get("thinking"), vision=True)
            if re.search(r"image", mid, re.I):             # مثل gemini-*-image: محادثة تُخرج صورًا أيضًا
                it["kind"], it["img"], it["imgOnly"] = "chat", True, False
            out.append(it)
        token = str(j.get("nextPageToken") or "")
        if not token:
            break
    return out


# ---------------------------------------------------------------------- Ollama
def _ollama(ep: Endpoint) -> List[dict]:
    d = REGISTRY["ollama"]
    root = api_root(ep)
    j = _get(ep, root + "/tags", d.headers(ep))
    names = [m.get("name") or m.get("model") for m in (j.get("models") or []) if isinstance(m, dict)]
    names = [n for n in names if isinstance(n, str) and n]
    out = [_item(n) for n in names]

    def detail(it: dict) -> None:                          # /api/show يعطي القدرات الصريحة ونافذة السياق
        try:
            resp = open_request(ep, root + "/show", d.headers(ep), {"model": it["id"]}, timeout=6, retries=0)
            info = read_json(resp)
        except Exception:
            return
        caps = info.get("capabilities") or []
        if caps:
            if "completion" not in caps and "embedding" in caps:
                it["kind"] = "embedding"
            it["vision"] = "vision" in caps or None
            it["think"] = "thinking" in caps or None
        mi = info.get("model_info") or {}
        for k, v in mi.items():
            if k.endswith(".context_length") and isinstance(v, int):
                it["ctx"] = v
                break

    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(detail, out[:60]))
    return [{k: v for k, v in it.items() if v not in (None, False)} for it in out]


# ------------------------------------------------------------------------ عام
def list_models(ep: Endpoint) -> dict:
    server = None
    if ep.dialect == "anthropic":
        items = _anthropic(ep)
    elif ep.dialect == "gemini" or ep.provider == "google":
        items = _gemini(ep)
    elif ep.dialect == "ollama":
        items = _ollama(ep)
    else:
        items = _openai(ep)
        if ep.local and items:
            server = _fingerprint_local(ep, items)
    seen, uniq = set(), []
    for it in items:
        if it["id"] not in seen:
            seen.add(it["id"])
            uniq.append(it)
    uniq.sort(key=lambda x: x["id"].lower())
    usable = [m for m in uniq if m["kind"] in ("chat", "image")]
    return {"ok": True, "provider": ep.provider, "label": server or ep.label, "dialect": ep.dialect,
            "models": usable if usable else uniq, "hidden": len(uniq) - len(usable) if usable else 0}
