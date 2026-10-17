"""مزوّدون وهميون لاختبار البوابة بدون إنترنت: OpenAI / Anthropic / Gemini / Ollama."""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG = []          # آخر الطلبات المستلمة (path, headers, body)
STATE = {"closed_early": 0}


class Up(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, *a):
        pass

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def _json(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _sse(self, events, delay=0.0):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        try:
            for name, data in events:
                if name:
                    self.wfile.write(("event: %s\n" % name).encode())
                self.wfile.write(("data: %s\n\n" % (data if isinstance(data, str) else json.dumps(data))).encode())
                self.wfile.flush()
                if delay:
                    time.sleep(delay)
        except (BrokenPipeError, ConnectionResetError):
            STATE["closed_early"] += 1

    # ---------------------------------------------------------------- GET
    def do_GET(self):
        LOG.append(("GET", self.path, dict(self.headers), None))
        p = self.path.split("?")[0]
        if p == "/openai/v1/models":
            if self.headers.get("Authorization") != "Bearer sk-good":
                return self._json(401, {"error": {"message": "Incorrect API key provided: sk-bad"}})
            return self._json(200, {"data": [{"id": "gpt-4o"}, {"id": "text-embedding-3-small"}, {"id": "whisper-1"}, {"id": "dall-e-3"},
                                              {"id": "or/vision-think", "context_length": 128000,
                                               "architecture": {"input_modalities": ["text", "image"], "output_modalities": ["text"]},
                                               "supported_parameters": ["reasoning"]},
                                              {"id": "or/img-gen", "architecture": {"output_modalities": ["image", "text"]}}]})
        if p == "/anthropic/v1/models":
            if self.headers.get("x-api-key") != "ak-good":
                return self._json(401, {"type": "error", "error": {"type": "authentication_error", "message": "invalid x-api-key"}})
            if "after_id=m2" in self.path:
                return self._json(200, {"data": [{"id": "m3", "display_name": "Model 3"}], "has_more": False, "last_id": "m3"})
            return self._json(200, {"data": [{"id": "m1", "display_name": "Model 1"}, {"id": "m2", "display_name": "Model 2"}], "has_more": True, "last_id": "m2"})
        if p == "/gemini/v1beta/models":
            if self.headers.get("x-goog-api-key") != "gk-good":
                return self._json(400, [{"error": {"code": 400, "message": "API key not valid. Please pass a valid API key."}}])
            if "pageToken=t2" in self.path:
                return self._json(200, {"models": [{"name": "models/gemini-img-image", "supportedGenerationMethods": ["generateContent"]}]})
            return self._json(200, {"models": [
                {"name": "models/gemini-pro", "displayName": "Gemini Pro", "inputTokenLimit": 1000000, "thinking": True, "supportedGenerationMethods": ["generateContent"]},
                {"name": "models/text-embedding-004", "supportedGenerationMethods": ["embedContent"]}], "nextPageToken": "t2"})
        if p == "/ollama/api/tags":
            return self._json(200, {"models": [{"name": "llama3:8b"}, {"name": "nomic-embed-text:latest"}]})
        self._json(404, {"error": "not found"})

    # --------------------------------------------------------------- POST
    def do_POST(self):
        body = self._body()
        LOG.append(("POST", self.path, dict(self.headers), body))
        p = self.path.split("?")[0]

        if p == "/openai/v1/chat/completions":
            if self.headers.get("Authorization") != "Bearer sk-good":
                return self._json(401, {"error": {"message": "Incorrect API key provided"}})
            model = body.get("model", "")
            if model == "o3-test" and "temperature" in body:
                return self._json(400, {"error": {"message": "Unsupported value: 'temperature' does not support 0.7 with this model. Only the default (1) value is supported."}})
            if model == "legacy-tok" and "max_tokens" in body:
                return self._json(400, {"error": {"message": "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."}})
            if model == "qwen3-nothink" and "chat_template_kwargs" in body:
                return self._json(400, {"error": {"message": "Unknown parameter: 'chat_template_kwargs'."}})
            if model == "ctx-full":
                return self._json(400, {"error": {"message": "This model's maximum context length is 8192 tokens, however you requested 9000"}})
            if model == "need-nostream" and body.get("stream"):
                return self._json(400, {"error": {"message": "Your organization must be verified to stream this model."}})
            if model == "empty-len":
                return self._sse([(None, {"choices": [{"delta": {}, "finish_reason": "length"}]}), (None, "[DONE]")])
            if model == "slow":
                evs = [(None, {"choices": [{"delta": {"content": "tok%d " % i}}]}) for i in range(200)]
                return self._sse(evs, delay=0.05)
            if not body.get("stream"):
                return self._json(200, {"choices": [{"message": {"content": "<think>hmm</think>\nplain answer", "reasoning_content": None}, "finish_reason": "stop"}],
                                        "usage": {"prompt_tokens": 5, "completion_tokens": 7}})
            evs = [
                (None, {"model": body["model"], "choices": [{"delta": {"reasoning_content": "step1 "}}]}),
                (None, {"choices": [{"delta": {"reasoning": "step2"}}]}),
                (None, {"choices": [{"delta": {"content": "Hel"}}]}),
                (None, {"choices": [{"delta": {"content": "lo"}, "finish_reason": "stop"}]}),
                (None, {"choices": [], "usage": {"prompt_tokens": 11, "completion_tokens": 3, "completion_tokens_details": {"reasoning_tokens": 2}}}),
                (None, "[DONE]")]
            if model == "tags":
                evs = [(None, {"choices": [{"delta": {"content": "<think>ab"}}]}), (None, {"choices": [{"delta": {"content": "c</think>\n\nanswer"}}]}), (None, "[DONE]")]
            return self._sse(evs)

        if p == "/openai/v1/images/generations":
            return self._json(200, {"data": [{"b64_json": "QUJD"}]})

        if p == "/or/v1/chat/completions":
            if "modalities" in body and body["modalities"] == ["image", "text"]:
                return self._json(400, {"error": {"message": "bad modalities"}})
            return self._json(200, {"choices": [{"message": {"content": "here", "images": [{"image_url": {"url": "data:image/png;base64,QUJD"}}]}}]})

        if p == "/anthropic/v1/messages":
            if self.headers.get("x-api-key") != "ak-good":
                return self._json(401, {"type": "error", "error": {"type": "authentication_error", "message": "invalid x-api-key"}})
            if self.headers.get("anthropic-version") != "2023-06-01":
                return self._json(400, {"error": {"message": "missing version"}})
            if body.get("model") == "overloaded":
                return self._sse([("error", {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}})])
            return self._sse([
                ("message_start", {"type": "message_start", "message": {"model": body["model"], "usage": {"input_tokens": 9, "output_tokens": 1}}}),
                ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": ""}}),
                ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "pondering"}}),
                ("content_block_delta", {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "Bon"}}),
                ("content_block_delta", {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "jour"}}),
                ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 4}}),
                ("message_stop", {"type": "message_stop"})])

        if p.startswith("/gemini/v1beta/models/") and ":streamGenerateContent" in p:
            if self.headers.get("x-goog-api-key") != "gk-good":
                return self._json(400, [{"error": {"code": 400, "message": "API key not valid. Please pass a valid API key."}}])
            return self._sse([(None, {"candidates": [{"content": {"parts": [{"text": "thinking...", "thought": True}]}}]}),
                              (None, {"candidates": [{"content": {"parts": [{"text": "Ciao"}]}, "finishReason": "STOP"}],
                                      "usageMetadata": {"promptTokenCount": 6, "candidatesTokenCount": 2, "thoughtsTokenCount": 3}})])
        if p.startswith("/gemini/v1beta/models/") and ":generateContent" in p:
            return self._json(200, {"candidates": [{"content": {"parts": [{"text": "img!"}, {"inlineData": {"mimeType": "image/png", "data": "QUJD"}}]}}]})

        if p == "/ollama/api/chat":
            lines = [{"message": {"role": "assistant", "thinking": "hm"}, "done": False},
                     {"message": {"role": "assistant", "content": "Hola"}, "done": False},
                     {"message": {"role": "assistant", "content": ""}, "done": True, "done_reason": "stop", "prompt_eval_count": 8, "eval_count": 2}]
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.end_headers()
            for l in lines:
                self.wfile.write((json.dumps(l) + "\n").encode())
            return
        if p == "/ollama/api/show":
            return self._json(200, {"capabilities": ["completion", "vision"] if body.get("model") == "llama3:8b" else ["embedding"],
                                    "model_info": {"llama.context_length": 8192}})
        self._json(404, {"error": "not found"})


def start():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Up)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
