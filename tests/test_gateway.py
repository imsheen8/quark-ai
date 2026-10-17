import json
import os
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

import mock_upstream  # noqa: E402
import serve  # noqa: E402

UP = mock_upstream.start()
UP_PORT = UP.server_address[1]
GW = serve.Server(("127.0.0.1", 0), serve.H)
GW.daemon_threads = True
threading.Thread(target=GW.serve_forever, daemon=True).start()
GW_URL = "http://127.0.0.1:%d/api/gw/" % GW.server_address[1]
U = "http://127.0.0.1:%d" % UP_PORT


def post(route, body, headers=None, raw=False):
    req = urllib.request.Request(GW_URL + route, json.dumps(body).encode(), {"Content-Type": "application/json", **(headers or {})})
    try:
        r = urllib.request.urlopen(req, timeout=20)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())
    data = r.read().decode()
    if raw:
        return r.status, data
    return r.status, json.loads(data)


def events(body):
    status, data = post("chat", body, raw=True)
    assert status == 200
    out = []
    for block in data.split("\n\n"):
        if block.startswith("data: "):
            out.append(json.loads(block[6:]))
    return out


def joined(evs, kind):
    return "".join(e["d"] for e in evs if e["t"] == kind)


def ep(path, key, proto="openai"):
    return {"url": U + path, "key": key, "proto": proto, "kind": "api"}


MSG = [{"role": "user", "content": "hi"}]


class Models(unittest.TestCase):
    def test_openai_filters_non_chat_and_reads_capabilities(self):
        _, r = post("models", {"endpoint": ep("/openai/v1", "sk-good")})
        ids = {m["id"]: m for m in r["models"]}
        self.assertTrue(r["ok"])
        self.assertIn("gpt-4o", ids)
        self.assertNotIn("text-embedding-3-small", ids)
        self.assertNotIn("whisper-1", ids)
        self.assertEqual(r["hidden"], 2)
        self.assertEqual(ids["dall-e-3"]["kind"], "image")
        self.assertTrue(ids["or/vision-think"]["vision"] and ids["or/vision-think"]["think"])
        self.assertEqual(ids["or/vision-think"]["ctx"], 128000)
        self.assertTrue(ids["or/img-gen"]["img"] and not ids["or/img-gen"].get("imgOnly"))

    def test_bad_key_is_friendly(self):
        _, r = post("models", {"endpoint": ep("/openai/v1", "sk-bad")})
        self.assertFalse(r["ok"])
        self.assertIn("المفتاح مرفوض", r["error"])

    def test_anthropic_paginates(self):
        _, r = post("models", {"endpoint": ep("/anthropic/v1", "ak-good", "anthropic")})
        self.assertEqual([m["id"] for m in r["models"]], ["m1", "m2", "m3"])
        self.assertEqual(r["dialect"], "anthropic")

    def test_gemini_native_paginates_and_filters(self):
        _, r = post("models", {"endpoint": ep("/gemini/v1beta", "gk-good", "gemini")})
        ids = {m["id"]: m for m in r["models"]}
        self.assertEqual(set(ids), {"gemini-pro", "gemini-img-image"})
        self.assertEqual(ids["gemini-pro"]["ctx"], 1000000)
        self.assertTrue(ids["gemini-img-image"]["img"])

    def test_ollama_details(self):
        _, r = post("models", {"endpoint": ep("/ollama/api", "", "ollama")})
        ids = {m["id"]: m for m in r["models"]}
        self.assertEqual(list(ids), ["llama3:8b"])
        self.assertEqual(ids["llama3:8b"]["ctx"], 8192)
        self.assertTrue(ids["llama3:8b"]["vision"])


class Chat(unittest.TestCase):
    def test_openai_stream_splits_reasoning_and_usage(self):
        evs = events({"endpoint": ep("/openai/v1", "sk-good"), "model": "gpt-4o", "messages": MSG, "params": {"temperature": 0.5, "max_tokens": 100}})
        self.assertEqual(joined(evs, "think"), "step1 step2")
        self.assertEqual(joined(evs, "text"), "Hello")
        self.assertEqual([e for e in evs if e["t"] == "usage"][0]["in"], 11)
        self.assertEqual(evs[-1]["t"], "done")
        sent = [l for l in mock_upstream.LOG if l[1] == "/openai/v1/chat/completions"][-1][3]
        self.assertEqual(sent["temperature"], 0.5)
        self.assertEqual(sent["max_tokens"], 100)

    def test_think_tags_in_content(self):
        evs = events({"endpoint": ep("/openai/v1", "sk-good"), "model": "tags", "messages": MSG})
        self.assertEqual(joined(evs, "think"), "abc")
        self.assertEqual(joined(evs, "text"), "answer")

    def test_images_and_system_are_sent_in_openai_shape(self):
        events({"endpoint": ep("/openai/v1", "sk-good"), "model": "gpt-4o", "system": "be brief",
                "messages": [{"role": "user", "content": "what is this", "images": [{"mime": "image/png", "data": "data:image/png;base64,QUJD"}]}]})
        sent = [l for l in mock_upstream.LOG if l[1] == "/openai/v1/chat/completions"][-1][3]
        self.assertEqual(sent["messages"][0], {"role": "system", "content": "be brief"})
        self.assertEqual(sent["messages"][1]["content"][1]["image_url"]["url"], "data:image/png;base64,QUJD")

    def test_adaptive_repair_drops_rejected_temperature(self):
        evs = events({"endpoint": ep("/openai/v1", "sk-good"), "model": "o3-test", "messages": MSG, "params": {"temperature": 0.7}})
        self.assertEqual(joined(evs, "text"), "Hello")

    def test_adaptive_repair_switches_token_param(self):
        evs = events({"endpoint": ep("/openai/v1", "sk-good"), "model": "legacy-tok", "messages": MSG, "params": {"max_tokens": 50}})
        self.assertEqual(joined(evs, "text"), "Hello")
        sent = [l for l in mock_upstream.LOG if l[1] == "/openai/v1/chat/completions"][-1][3]
        self.assertEqual(sent["max_completion_tokens"], 50)
        self.assertNotIn("max_tokens", sent)

    def test_unsupported_thinking_toggle_is_dropped(self):
        # الخادم المحلي + نموذج من عائلة qwen3 → نرسل chat_template_kwargs؛ الخادم يرفضه → يُعاد الطلب بدونه
        evs = events({"endpoint": ep("/openai/v1", "sk-good"), "model": "qwen3-nothink", "messages": MSG, "options": {"thinking": "off"}})
        self.assertEqual(joined(evs, "text"), "Hello")
        posts = [l[3] for l in mock_upstream.LOG if l[1] == "/openai/v1/chat/completions" and l[3].get("model") == "qwen3-nothink"]
        self.assertIn("chat_template_kwargs", posts[-2])
        self.assertNotIn("chat_template_kwargs", posts[-1])

    def test_stream_unsupported_falls_back_to_single_response(self):
        evs = events({"endpoint": ep("/openai/v1", "sk-good"), "model": "need-nostream", "messages": MSG})
        self.assertEqual(joined(evs, "text"), "plain answer")
        self.assertEqual(joined(evs, "think"), "hmm")

    def test_context_error_message(self):
        evs = events({"endpoint": ep("/openai/v1", "sk-good"), "model": "ctx-full", "messages": MSG})
        self.assertIn("نافذة سياق", [e for e in evs if e["t"] == "error"][0]["msg"])

    def test_empty_with_length_explains(self):
        evs = events({"endpoint": ep("/openai/v1", "sk-good"), "model": "empty-len", "messages": MSG})
        self.assertIn("Max Tokens", [e for e in evs if e["t"] == "error"][0]["msg"])

    def test_auth_error(self):
        evs = events({"endpoint": ep("/openai/v1", "nope"), "model": "gpt-4o", "messages": MSG})
        e = [e for e in evs if e["t"] == "error"][0]
        self.assertEqual(e["status"], 401)
        self.assertIn("المفتاح مرفوض", e["msg"])

    def test_anthropic_native(self):
        evs = events({"endpoint": ep("/anthropic/v1", "ak-good", "anthropic"), "model": "claude-sonnet-4-6", "system": "sys",
                      "messages": [{"role": "assistant", "content": "ignored lead"}, {"role": "user", "content": "hi"}],
                      "params": {"temperature": 1.7}})
        self.assertEqual(joined(evs, "text"), "Bonjour")
        self.assertEqual(joined(evs, "think"), "pondering")
        sent = [l for l in mock_upstream.LOG if l[1] == "/anthropic/v1/messages"][-1]
        self.assertEqual(sent[3]["temperature"], 1.0)                 # مُقصّ إلى 1
        self.assertEqual(sent[3]["system"], "sys")
        self.assertEqual(sent[3]["messages"][0]["role"], "user")      # حُذفت الرسالة الافتتاحية من المساعد
        self.assertEqual(sent[3]["max_tokens"], 4096)
        usage = [e for e in evs if e["t"] == "usage"][0]
        self.assertEqual((usage["in"], usage["out"]), (9, 4))

    def test_anthropic_opus_47_omits_temperature_and_thinking_budget(self):
        events({"endpoint": ep("/anthropic/v1", "ak-good", "anthropic"), "model": "claude-opus-4-7", "messages": MSG, "params": {"temperature": 0.3}})
        sent = [l for l in mock_upstream.LOG if l[1] == "/anthropic/v1/messages"][-1][3]
        self.assertNotIn("temperature", sent)
        events({"endpoint": ep("/anthropic/v1", "ak-good", "anthropic"), "model": "claude-sonnet-4-6", "messages": MSG,
                "params": {"temperature": 0.3, "max_tokens": 4000}, "options": {"thinking": "on"}})
        sent = [l for l in mock_upstream.LOG if l[1] == "/anthropic/v1/messages"][-1][3]
        self.assertNotIn("temperature", sent)
        self.assertEqual(sent["thinking"]["type"], "enabled")
        self.assertLess(sent["thinking"]["budget_tokens"], sent["max_tokens"])

    def test_anthropic_stream_error_event(self):
        evs = events({"endpoint": ep("/anthropic/v1", "ak-good", "anthropic"), "model": "overloaded", "messages": MSG})
        self.assertEqual([e for e in evs if e["t"] == "error"][0]["code"], "overloaded")

    def test_gemini_native(self):
        evs = events({"endpoint": ep("/gemini/v1beta", "gk-good", "gemini"), "model": "gemini-pro", "system": "s",
                      "messages": [{"role": "user", "content": "hi", "images": [{"mime": "image/jpeg", "data": "data:image/jpeg;base64,QUJD"}]}],
                      "params": {"temperature": 0.4, "top_p": 0.9, "max_tokens": 77}})
        self.assertEqual(joined(evs, "text"), "Ciao")
        self.assertEqual(joined(evs, "think"), "thinking...")
        sent = [l for l in mock_upstream.LOG if ":streamGenerateContent" in l[1]][-1]
        self.assertIn("alt=sse", sent[1])
        b = sent[3]
        self.assertEqual(b["generationConfig"], {"temperature": 0.4, "topP": 0.9, "maxOutputTokens": 77})
        self.assertEqual(b["systemInstruction"]["parts"][0]["text"], "s")
        self.assertEqual(b["contents"][0]["parts"][1]["inlineData"], {"mimeType": "image/jpeg", "data": "QUJD"})
        self.assertEqual([e for e in evs if e["t"] == "usage"][0]["out"], 5)

    def test_gemini_bad_key(self):
        evs = events({"endpoint": ep("/gemini/v1beta", "bad", "gemini"), "model": "gemini-pro", "messages": MSG})
        self.assertIn("المفتاح مرفوض", [e for e in evs if e["t"] == "error"][0]["msg"])

    def test_ollama_native(self):
        evs = events({"endpoint": ep("/ollama/api", "", "ollama"), "model": "llama3:8b", "messages": MSG, "params": {"temperature": 0.2, "max_tokens": 33}})
        self.assertEqual(joined(evs, "text"), "Hola")
        self.assertEqual(joined(evs, "think"), "hm")
        sent = [l for l in mock_upstream.LOG if l[1] == "/ollama/api/chat"][-1][3]
        self.assertEqual(sent["options"], {"temperature": 0.2, "num_predict": 33, "num_ctx": 8192})

    def test_once_returns_text_and_usage(self):
        _, r = post("once", {"endpoint": ep("/openai/v1", "sk-good"), "model": "gpt-4o", "messages": MSG})
        self.assertTrue(r["ok"])
        self.assertEqual(r["text"], "plain answer")
        self.assertEqual(r["think"], "hmm")
        self.assertEqual(r["usage"]["in"], 5)


class Images(unittest.TestCase):
    def test_openai_images_api(self):
        _, r = post("image", {"endpoint": ep("/openai/v1", "sk-good"), "model": "dall-e-3", "messages": [{"role": "user", "content": "a cat"}]})
        self.assertTrue(r["ok"])
        self.assertEqual(r["images"][0]["data"], "data:image/png;base64,QUJD")

    def test_chat_modalities_retries_other_order(self):
        _, r = post("image", {"endpoint": ep("/or/v1", "k"), "model": "x/img", "messages": [{"role": "user", "content": "a dog"}], "options": {"imageOnly": False}})
        self.assertTrue(r["ok"])
        self.assertEqual(r["text"], "here")

    def test_gemini_image(self):
        _, r = post("image", {"endpoint": ep("/gemini/v1beta", "gk-good", "gemini"), "model": "gemini-x-image", "messages": [{"role": "user", "content": "a bird"}]})
        self.assertEqual(r["images"][0]["data"], "data:image/png;base64,QUJD")

    def test_anthropic_not_supported(self):
        _, r = post("image", {"endpoint": ep("/anthropic/v1", "ak-good", "anthropic"), "model": "m", "messages": MSG})
        self.assertFalse(r["ok"])


class Security(unittest.TestCase):
    def test_health(self):
        r = urllib.request.urlopen(GW_URL + "health", timeout=5)
        self.assertTrue(json.loads(r.read())["ok"])

    def test_cross_origin_requires_token(self):
        s, r = post("models", {"endpoint": ep("/openai/v1", "sk-good")}, headers={"Origin": "https://evil.example"})
        self.assertEqual(s, 403)
        os.environ["QUARK_GW_TOKEN"] = "sekret"
        try:
            s, r = post("models", {"endpoint": ep("/openai/v1", "sk-good")}, headers={"Origin": "https://app.example", "X-Quark-Token": "sekret"})
            self.assertEqual(s, 200)
            s, r = post("models", {"endpoint": ep("/openai/v1", "sk-good")}, headers={"Origin": "https://app.example", "X-Quark-Token": "wrong"})
            self.assertEqual(s, 403)
        finally:
            os.environ.pop("QUARK_GW_TOKEN")

    def test_metadata_host_blocked(self):
        _, r = post("models", {"endpoint": {"url": "http://169.254.169.254/latest", "key": ""}})
        self.assertFalse(r["ok"])

    def test_bad_url(self):
        s, r = post("once", {"endpoint": {"url": "ftp://x"}, "model": "m", "messages": MSG})
        self.assertEqual(s, 400)

    def test_client_disconnect_stops_upstream(self):
        before = mock_upstream.STATE["closed_early"]
        body = json.dumps({"endpoint": ep("/openai/v1", "sk-good"), "model": "slow", "messages": MSG}).encode()
        req = urllib.request.Request(GW_URL + "chat", body, {"Content-Type": "application/json"})
        r = urllib.request.urlopen(req, timeout=10)
        r.readline()
        r.close()
        for _ in range(60):
            if mock_upstream.STATE["closed_early"] > before:
                break
            time.sleep(0.1)
        self.assertGreater(mock_upstream.STATE["closed_early"], before)


if __name__ == "__main__":
    unittest.main(verbosity=2)
