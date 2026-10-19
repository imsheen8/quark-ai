"""صيغة OpenAI Chat Completions — يتكلمها أغلب المزوّدين (OpenRouter وGroq وDeepSeek وLM Studio وllama.cpp وvLLM …)."""
from __future__ import annotations

import json
from typing import Dict, Iterator

from .. import rules
from ..errors import GatewayError, extract_detail
from ..providers import Endpoint
from .base import Adjust, ChatRequest, Dialect, event, sse_data


def _text_of(content) -> tuple:
    """content قد يكون نصًا أو قائمة أجزاء (Mistral تُعيد جزء thinking داخل القائمة)."""
    if isinstance(content, str):
        return content, ""
    if not isinstance(content, list):
        return "", ""
    text, think = [], []
    for part in content:
        if isinstance(part, str):
            text.append(part)
        elif isinstance(part, dict):
            kind = part.get("type")
            if kind == "text":
                text.append(str(part.get("text") or ""))
            elif kind in ("thinking", "reasoning"):
                inner = part.get("thinking") if "thinking" in part else part.get("reasoning") or part.get("text")
                if isinstance(inner, list):
                    inner = "".join(str(x.get("text") or "") for x in inner if isinstance(x, dict))
                think.append(str(inner or ""))
    return "".join(text), "".join(think)


def _reasoning_of(delta: dict) -> str:
    for key in ("reasoning_content", "reasoning", "reasoning_text"):
        v = delta.get(key)
        if isinstance(v, str) and v:
            return v
    det = delta.get("reasoning_details")
    if isinstance(det, list):                      # OpenRouter يعيد التفاصيل أيضًا — نستعملها عند غياب الحقل النصي
        return "".join(str(d.get("text") or "") for d in det if isinstance(d, dict) and d.get("type", "").endswith("text"))
    return ""


def _usage_event(u) -> dict:
    if not isinstance(u, dict):
        return {}
    det = u.get("completion_tokens_details") or {}
    out = {"in": u.get("prompt_tokens") or u.get("input_tokens") or 0,
           "out": u.get("completion_tokens") or u.get("output_tokens") or 0}
    if isinstance(det, dict) and det.get("reasoning_tokens"):
        out["think"] = det["reasoning_tokens"]
    return event("usage", **out) if (out["in"] or out["out"]) else {}


class OpenAIChat(Dialect):
    name = "openai"

    def chat_url(self, ep: Endpoint, model: str, stream: bool) -> str:
        if ep.url.rstrip("/").endswith("/qk"):        # وسيط QUARK المُدار (مسار بديل لا تحجبه الاستضافات)
            return ep.url.rstrip("/") + "/chat"
        return ep.url + "/chat/completions"

    def headers(self, ep: Endpoint) -> Dict[str, str]:
        h: Dict[str, str] = {}
        if ep.key:
            h["Authorization"] = "Bearer " + ep.key
        if ep.provider == "azure" and ep.key:
            h["api-key"] = ep.key
        if ep.provider == "openrouter":
            h["X-Title"] = "QUARK AI"
        return h

    # ---------------------------------------------------------------- build
    def build(self, req: ChatRequest, adj: Adjust) -> dict:
        ep, p = req.ep, req.params
        msgs = []
        if req.system:
            msgs.append({"role": "system", "content": req.system})
        for m in req.messages:
            if m.images:
                parts = ([{"type": "text", "text": m.content}] if m.content else [])
                parts += [{"type": "image_url", "image_url": {"url": "data:%s;base64,%s" % (mime, b64)}} for mime, b64 in m.images]
                msgs.append({"role": m.role, "content": parts})
            else:
                msgs.append({"role": m.role, "content": m.content})
        body: dict = {"model": req.model, "messages": msgs, "stream": bool(req.stream)}

        fixed = rules.fixed_sampling(ep, req.model)
        if not fixed:
            if "temperature" in p and adj.use("temperature"):
                body["temperature"] = p["temperature"]
            if "top_p" in p and adj.use("top_p"):
                body["top_p"] = p["top_p"]
        if p.get("max_tokens"):
            key = adj.token_key or rules.token_param(ep, req.model)
            adj.used.add("max_tokens")
            body[key] = int(p["max_tokens"])
        if req.stream and rules.wants_usage_option(ep) and adj.use("stream_options"):
            body["stream_options"] = {"include_usage": True}
        if req.thinking in ("on", "off") and adj.use("thinking"):
            self._thinking(body, req)
        return body

    @staticmethod
    def _thinking(body: dict, req: ChatRequest) -> None:
        on = req.thinking == "on"
        ep, model = req.ep, req.model.lower()
        if ep.provider == "openrouter":
            body["reasoning"] = {"enabled": True} if on else {"effort": "none"}
        elif ep.provider in ("moonshot", "kimi", "deepseek", "zai"):
            body["thinking"] = {"type": "enabled" if on else "disabled"}
        elif ep.local and rules.looks_like_thinking_model(model):
            if ep.port == 11434:
                body["think"] = on                                   # واجهة Ollama المتوافقة
            else:
                body["chat_template_kwargs"] = {"enable_thinking": on}   # vLLM / llama.cpp / LM Studio

    # --------------------------------------------------------------- stream
    def stream_events(self, lines: Iterator[str], req: ChatRequest) -> Iterator[dict]:
        announced = False
        usage: dict = {}
        finish = ""
        for data in sse_data(lines):
            if data == "[DONE]":
                break
            try:
                j = json.loads(data)
            except ValueError:
                continue
            if not isinstance(j, dict):
                continue
            if j.get("error"):
                raise GatewayError(extract_detail(json.dumps(j)) or "خطأ من المزوّد أثناء البث", None, "stream_error")
            if not announced and isinstance(j.get("model"), str) and j["model"]:
                announced = True
                if j["model"] != req.model:
                    yield event("meta", model=j["model"])
            u = _usage_event(j.get("usage"))
            if u:
                usage = u
            for ch in j.get("choices") or []:
                if not isinstance(ch, dict):
                    continue
                d = ch.get("delta") or ch.get("message") or {}
                r = _reasoning_of(d)
                if r:
                    yield event("think", d=r)
                text, think = _text_of(d.get("content"))
                if think:
                    yield event("think", d=think)
                if text:
                    yield event("text", d=text)
                if ch.get("finish_reason"):
                    finish = str(ch["finish_reason"])
        if usage:
            yield usage
        if finish:
            yield event("finish", reason=finish)

    def once_events(self, data: dict, req: ChatRequest) -> Iterator[dict]:
        if data.get("error"):
            raise GatewayError(extract_detail(json.dumps(data)) or "خطأ من المزوّد", None, "stream_error")
        ch = (data.get("choices") or [{}])[0] or {}
        msg = ch.get("message") or {}
        r = _reasoning_of(msg)
        if r:
            yield event("think", d=r)
        text, think = _text_of(msg.get("content"))
        if think:
            yield event("think", d=think)
        if text:
            yield event("text", d=text)
        u = _usage_event(data.get("usage"))
        if u:
            yield u
        if ch.get("finish_reason"):
            yield event("finish", reason=str(ch["finish_reason"]))
