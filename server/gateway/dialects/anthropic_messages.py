"""صيغة Anthropic Messages (وكذلك الخوادم التي تقلّدها)."""
from __future__ import annotations

import json
from typing import Dict, Iterator

from .. import rules
from ..errors import GatewayError, extract_detail
from ..providers import Endpoint
from .base import Adjust, ChatRequest, Dialect, event, sse_data, user_first

DEFAULT_MAX_TOKENS = 4096


class AnthropicMessages(Dialect):
    name = "anthropic"

    def chat_url(self, ep: Endpoint, model: str, stream: bool) -> str:
        return ep.url + "/messages"

    def headers(self, ep: Endpoint) -> Dict[str, str]:
        h = {"anthropic-version": "2023-06-01"}
        if ep.key:
            h["x-api-key"] = ep.key
        return h

    def build(self, req: ChatRequest, adj: Adjust) -> dict:
        p = req.params
        msgs = []
        for m in user_first(req.messages):
            if m.images:
                blocks = [{"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}} for mime, b64 in m.images]
                if m.content:
                    blocks.append({"type": "text", "text": m.content})
                msgs.append({"role": m.role, "content": blocks})
            else:
                msgs.append({"role": m.role, "content": m.content})
        max_tokens = int(p.get("max_tokens") or DEFAULT_MAX_TOKENS)
        body: dict = {"model": req.model, "max_tokens": max_tokens, "messages": msgs, "stream": bool(req.stream)}
        if req.system:
            body["system"] = req.system

        thinking_on = req.thinking == "on" and adj.use("thinking")
        if thinking_on:
            # التفكير الممتد يتطلب ميزانية أقل من max_tokens، ولا يقبل temperature
            budget = max(1024, min(16000, max_tokens // 2))
            if max_tokens <= budget:
                body["max_tokens"] = budget + 2048
            body["thinking"] = {"type": "enabled", "budget_tokens": budget}
        elif not rules.anthropic_drops_sampling(req.model):
            if "temperature" in p and adj.use("temperature"):
                t = rules.clamp(p["temperature"], 0.0, 1.0)
                if t is not None:
                    body["temperature"] = t
            elif "top_p" in p and adj.use("top_p"):      # Anthropic لا تحب الجمع بين الاثنين
                body["top_p"] = p["top_p"]
        return body

    def stream_events(self, lines: Iterator[str], req: ChatRequest) -> Iterator[dict]:
        usage_in = usage_out = 0
        stop = ""
        for data in sse_data(lines):
            try:
                j = json.loads(data)
            except ValueError:
                continue
            kind = j.get("type")
            if kind == "message_start":
                msg = j.get("message") or {}
                u = msg.get("usage") or {}
                usage_in = (u.get("input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0)
                usage_out = u.get("output_tokens") or 0
                if msg.get("model") and msg["model"] != req.model:
                    yield event("meta", model=msg["model"])
            elif kind == "content_block_delta":
                d = j.get("delta") or {}
                if d.get("type") == "text_delta" and d.get("text"):
                    yield event("text", d=d["text"])
                elif d.get("type") == "thinking_delta" and d.get("thinking"):
                    yield event("think", d=d["thinking"])
            elif kind == "message_delta":
                u = j.get("usage") or {}
                usage_out = u.get("output_tokens") or usage_out
                stop = (j.get("delta") or {}).get("stop_reason") or stop
            elif kind == "error":
                err = j.get("error") or {}
                msg = err.get("message") or extract_detail(json.dumps(j)) or "خطأ من المزوّد"
                raise GatewayError(msg, None, "overloaded" if err.get("type") == "overloaded_error" else "stream_error")
            elif kind == "message_stop":
                break
        if usage_in or usage_out:
            yield event("usage", **{"in": usage_in, "out": usage_out})
        if stop:
            yield event("finish", reason=stop)

    def once_events(self, data: dict, req: ChatRequest) -> Iterator[dict]:
        for b in data.get("content") or []:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "thinking" and b.get("thinking"):
                yield event("think", d=b["thinking"])
            elif b.get("type") == "text" and b.get("text"):
                yield event("text", d=b["text"])
        u = data.get("usage") or {}
        if u:
            yield event("usage", **{"in": u.get("input_tokens") or 0, "out": u.get("output_tokens") or 0})
        if data.get("stop_reason"):
            yield event("finish", reason=data["stop_reason"])
