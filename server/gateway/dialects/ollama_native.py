"""صيغة Ollama الأصلية /api/chat (بث NDJSON)."""
from __future__ import annotations

import json
import os
from typing import Dict, Iterator

from ..errors import GatewayError
from ..providers import Endpoint
from .base import Adjust, ChatRequest, Dialect, event


def api_root(ep: Endpoint) -> str:
    url = ep.url.rstrip("/")
    return url if url.endswith("/api") else url + "/api"


class OllamaNative(Dialect):
    name = "ollama"

    def chat_url(self, ep: Endpoint, model: str, stream: bool) -> str:
        return api_root(ep) + "/chat"

    def headers(self, ep: Endpoint) -> Dict[str, str]:
        return {"Authorization": "Bearer " + ep.key} if ep.key else {}

    def build(self, req: ChatRequest, adj: Adjust) -> dict:
        p = req.params
        msgs = []
        if req.system:
            msgs.append({"role": "system", "content": req.system})
        for m in req.messages:
            o = {"role": m.role, "content": m.content}
            if m.images:
                o["images"] = [b64 for _, b64 in m.images]       # Ollama تريد base64 خامًا بلا بادئة
            msgs.append(o)
        body: dict = {"model": req.model, "messages": msgs, "stream": bool(req.stream)}
        opts: dict = {}
        if "temperature" in p and adj.use("temperature"):
            opts["temperature"] = p["temperature"]
        if "top_p" in p and adj.use("top_p"):
            opts["top_p"] = p["top_p"]
        if p.get("max_tokens"):
            opts["num_predict"] = int(p["max_tokens"])
        if req.num_ctx and adj.use("num_ctx"):
            opts["num_ctx"] = int(req.num_ctx)
        if opts:
            body["options"] = opts
        if req.thinking in ("on", "off") and adj.use("thinking"):
            body["think"] = req.thinking == "on"
        return body

    @staticmethod
    def _usage(j: dict) -> dict:
        if j.get("prompt_eval_count") or j.get("eval_count"):
            return event("usage", **{"in": j.get("prompt_eval_count") or 0, "out": j.get("eval_count") or 0})
        return {}

    def stream_events(self, lines: Iterator[str], req: ChatRequest) -> Iterator[dict]:
        usage, finish = {}, ""
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                j = json.loads(line)
            except ValueError:
                continue
            if j.get("error"):
                raise GatewayError(str(j["error"])[:300], None, "stream_error")
            msg = j.get("message") or {}
            if msg.get("thinking"):
                yield event("think", d=msg["thinking"])
            if msg.get("content"):
                yield event("text", d=msg["content"])
            if j.get("done"):
                usage = self._usage(j)
                finish = j.get("done_reason") or ""
                break
        if usage:
            yield usage
        if finish and finish != "stop":
            yield event("finish", reason=finish)

    def once_events(self, data: dict, req: ChatRequest) -> Iterator[dict]:
        if data.get("error"):
            raise GatewayError(str(data["error"])[:300], None, "stream_error")
        msg = data.get("message") or {}
        if msg.get("thinking"):
            yield event("think", d=msg["thinking"])
        if msg.get("content"):
            yield event("text", d=msg["content"])
        u = self._usage(data)
        if u:
            yield u


def default_ctx_cap() -> int:
    try:
        return max(2048, int(os.environ.get("QUARK_OLLAMA_CTX_CAP", "16384")))
    except ValueError:
        return 16384
