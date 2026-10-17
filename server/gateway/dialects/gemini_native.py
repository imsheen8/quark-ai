"""صيغة Google Gemini الأصلية (generateContent / streamGenerateContent)."""
from __future__ import annotations

import json
from typing import Dict, Iterator

from ..errors import GatewayError, extract_detail
from ..providers import Endpoint
from .base import Adjust, ChatRequest, Dialect, event, sse_data, user_first


def model_path(model: str) -> str:
    m = (model or "").strip()
    return m if m.startswith(("models/", "tunedModels/")) else "models/" + m


class GeminiNative(Dialect):
    name = "gemini"

    def chat_url(self, ep: Endpoint, model: str, stream: bool) -> str:
        if stream:
            return "%s/%s:streamGenerateContent?alt=sse" % (ep.url, model_path(model))
        return "%s/%s:generateContent" % (ep.url, model_path(model))

    def headers(self, ep: Endpoint) -> Dict[str, str]:
        return {"x-goog-api-key": ep.key} if ep.key else {}

    def build(self, req: ChatRequest, adj: Adjust, image_output: bool = False) -> dict:
        p = req.params
        contents = []
        for m in user_first(req.messages):
            parts = []
            if m.content:
                parts.append({"text": m.content})
            for mime, b64 in m.images:
                parts.append({"inlineData": {"mimeType": mime, "data": b64}})
            contents.append({"role": "model" if m.role == "assistant" else "user", "parts": parts})
        body: dict = {"contents": contents}
        if req.system:
            body["systemInstruction"] = {"parts": [{"text": req.system}]}
        gen: dict = {}
        if "temperature" in p and adj.use("temperature"):
            gen["temperature"] = p["temperature"]
        if "top_p" in p and adj.use("top_p"):
            gen["topP"] = p["top_p"]
        if p.get("max_tokens"):
            gen["maxOutputTokens"] = int(p["max_tokens"])
        if image_output:
            gen["responseModalities"] = ["TEXT", "IMAGE"]
        elif req.thinking in ("on", "off") and adj.use("thinking"):
            gen["thinkingConfig"] = {"includeThoughts": True} if req.thinking == "on" else {"thinkingBudget": 0}
        if gen:
            body["generationConfig"] = gen
        return body

    def _parts(self, cand: dict) -> Iterator[dict]:
        for part in ((cand.get("content") or {}).get("parts") or []):
            if not isinstance(part, dict):
                continue
            if part.get("text"):
                yield event("think" if part.get("thought") else "text", d=part["text"])
            inline = part.get("inlineData") or part.get("inline_data")
            if isinstance(inline, dict) and inline.get("data"):
                yield event("image", mime=inline.get("mimeType") or inline.get("mime_type") or "image/png", data=inline["data"])

    def _check_block(self, j: dict) -> None:
        fb = j.get("promptFeedback") or {}
        if fb.get("blockReason"):
            raise GatewayError("رفض Gemini الطلب لأسباب تتعلق بالمحتوى (%s)." % fb["blockReason"], None, "safety")

    @staticmethod
    def _usage(j: dict) -> dict:
        u = j.get("usageMetadata") or {}
        if not u:
            return {}
        out = {"in": u.get("promptTokenCount") or 0,
               "out": (u.get("candidatesTokenCount") or 0) + (u.get("thoughtsTokenCount") or 0)}
        if u.get("thoughtsTokenCount"):
            out["think"] = u["thoughtsTokenCount"]
        return event("usage", **out)

    def stream_events(self, lines: Iterator[str], req: ChatRequest) -> Iterator[dict]:
        usage, finish = {}, ""
        for data in sse_data(lines):
            try:
                j = json.loads(data)
            except ValueError:
                continue
            if isinstance(j, dict) and j.get("error"):
                raise GatewayError(extract_detail(data) or "خطأ من Gemini", None, "stream_error")
            if not isinstance(j, dict):
                continue
            self._check_block(j)
            for cand in j.get("candidates") or []:
                yield from self._parts(cand)
                if cand.get("finishReason") and cand["finishReason"] != "STOP":
                    finish = cand["finishReason"]
            usage = self._usage(j) or usage
        if usage:
            yield usage
        if finish:
            yield event("finish", reason=finish)

    def once_events(self, data: dict, req: ChatRequest) -> Iterator[dict]:
        if data.get("error"):
            raise GatewayError(extract_detail(json.dumps(data)) or "خطأ من Gemini", None, "stream_error")
        self._check_block(data)
        finish = ""
        for cand in data.get("candidates") or []:
            yield from self._parts(cand)
            if cand.get("finishReason") and cand["finishReason"] != "STOP":
                finish = cand["finishReason"]
        u = self._usage(data)
        if u:
            yield u
        if finish:
            yield event("finish", reason=finish)
