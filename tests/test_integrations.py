"""اختبار وحدة التكاملات (استدعاء API وWebhooks) على خادم HTTP محلي.

    python3 tests/test_integrations.py
"""
import hashlib
import hmac
import json
import os
import socketserver
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from server.gateway import integrations as I  # noqa: E402
from server.gateway.errors import GatewayError  # noqa: E402

LAST = {}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _go(self):
        n = int(self.headers.get("Content-Length") or 0)
        LAST.update(method=self.command, path=self.path, headers={k.lower(): v for k, v in self.headers.items()}, body=self.rfile.read(n))
        if self.path.startswith("/redir"):
            self.send_response(302); self.send_header("Location", "http://169.254.169.254/latest"); self.end_headers(); return
        if self.path.startswith("/big"):
            out = json.dumps({"items": ["x" * 50] * 1000}).encode()
        elif self.path.startswith("/missing"):
            self.send_response(404); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b'{"error":"nope"}'); return
        else:
            out = json.dumps({"ok": True, "عربي": "نعم"}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)

    do_GET = do_POST = do_PUT = do_DELETE = _go


class Srv(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class T(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = Srv(("127.0.0.1", 0), H)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]

    def integ(self, **kw):
        return dict({"base_url": self.base, "auth_type": "none", "api_key": ""}, **kw)

    def call(self, path="/x", method="GET", **kw):
        integ = kw.pop("integ", None) or self.integ()
        return I.call(dict(integration=integ, method=method, path=path, **kw))

    # ---- التحقق من المدخلات
    def test_base_url_rules(self):
        self.assertEqual(I.normalize_base("HTTP://Example.com:8080/api/"), "http://example.com:8080/api")
        for bad in ("", "ftp://x.com", "javascript:alert(1)", "http://u:p@x.com", "http://x.com?a=1", "http://x.com#f", "http://x .com", "http://x.com:99999"):
            with self.assertRaises(GatewayError, msg=bad):
                I.normalize_base(bad)

    def test_path_rules(self):
        self.assertEqual(I.check_path("/api/states?x=1"), "/api/states?x=1")
        for bad in ("api/x", "//evil.com/x", "http://evil.com/x", "/a/../b", "/a/%2e%2e/b", "/a#frag", "/a\r\nHost: x", "/a b", "/a\\b"):
            with self.assertRaises(GatewayError, msg=bad):
                I.check_path(bad)

    # ---- المصادقة
    def test_auth_modes(self):
        self.call(integ=self.integ(auth_type="bearer", api_key="K1"))
        self.assertEqual(LAST["headers"]["authorization"], "Bearer K1")
        self.call(integ=self.integ(auth_type="header", auth_header="X-Auth-Token", api_key="K2"))
        self.assertEqual(LAST["headers"]["x-auth-token"], "K2")
        self.call(integ=self.integ(auth_type="header", auth_header="Authorization", api_key="token K3"))
        self.assertEqual(LAST["headers"]["authorization"], "token K3")          # القيمة كما أدخلها المستخدم
        self.call(integ=self.integ(auth_type="query", auth_param="apikey", api_key="K4"), params={"a": 1})
        self.assertIn("apikey=K4", LAST["path"]); self.assertIn("a=1", LAST["path"])
        self.call(integ=self.integ(auth_type="basic", api_key="user:pw"))
        import base64
        self.assertEqual(LAST["headers"]["authorization"], "Basic " + base64.b64encode(b"user:pw").decode())
        self.call()
        self.assertNotIn("authorization", LAST["headers"])
        with self.assertRaises(GatewayError):
            self.call(integ=self.integ(auth_type="header", auth_header="Bad Header", api_key="k"))
        with self.assertRaises(GatewayError):
            self.call(integ=self.integ(auth_type="bearer", api_key="a\r\nX-Evil: 1"))

    # ---- الطلب والرد
    def test_json_body_and_methods(self):
        r = self.call("/items", "POST", body={"title": "عنوان"})
        self.assertEqual((r["status"], LAST["method"]), (200, "POST"))
        self.assertEqual(json.loads(LAST["body"].decode()), {"title": "عنوان"})
        self.assertEqual(LAST["headers"]["content-type"], "application/json")
        self.assertIn("نعم", r["body"])
        self.call("/items/1", "DELETE"); self.assertEqual(LAST["method"], "DELETE")
        self.call("/g", "GET", body={"ignored": 1}); self.assertEqual(LAST["body"], b"")
        with self.assertRaises(GatewayError):
            self.call("/x", "TRACE")

    def test_root_path_and_prefix(self):
        self.call("/"); self.assertEqual(LAST["path"], "/")
        self.call("/api/", integ=self.integ(base_url=self.base + "/prefix")); self.assertEqual(LAST["path"], "/prefix/api/")
        self.call("/", integ=self.integ(base_url=self.base + "/prefix")); self.assertEqual(LAST["path"], "/prefix")

    def test_truncation_and_errors_are_data(self):
        r = self.call("/big")
        self.assertTrue(r["truncated"] and len(r["body"]) < 12200 and r["total"] > 12000)
        r = self.call("/missing")                                             # 404 يصل للنموذج كبيانات لا كاستثناء
        self.assertEqual(r["status"], 404); self.assertIn("nope", r["body"])

    def test_no_redirect_follow(self):
        r = self.call("/redir")
        self.assertEqual(r["status"], 302); self.assertEqual(r["location"], "http://169.254.169.254/latest")

    # ---- SSRF
    def test_metadata_always_blocked(self):
        for h in ("http://169.254.169.254", "http://[fd00:ec2::254]", "http://metadata.google.internal", "http://169.254.10.1:8080"):
            with self.assertRaises(GatewayError, msg=h) as cm:
                self.call(integ=self.integ(base_url=h))
            self.assertIn(cm.exception.code, ("blocked", "dns", "network"))

    def test_private_block_switch(self):
        os.environ["QUARK_GW_INT_BLOCK_PRIVATE"] = "1"
        try:
            with self.assertRaises(GatewayError) as cm:
                self.call()
            self.assertEqual(cm.exception.code, "blocked")
        finally:
            del os.environ["QUARK_GW_INT_BLOCK_PRIVATE"]
        self.assertEqual(self.call()["status"], 200)

    def test_connection_refused_is_friendly(self):
        with self.assertRaises(GatewayError) as cm:
            self.call(integ=self.integ(base_url="http://127.0.0.1:1"))
        self.assertIn(cm.exception.code, ("refused", "network"))

    def test_key_not_in_errors(self):
        try:
            self.call(integ=self.integ(base_url="http://127.0.0.1:1", auth_type="bearer", api_key="SUPERSECRET"))
        except GatewayError as e:
            self.assertNotIn("SUPERSECRET", e.message)

    # ---- Webhooks
    def test_webhook_public_only_by_default(self):
        with self.assertRaises(GatewayError) as cm:
            I.webhook({"url": self.base + "/hook", "event": "webhook.test"})
        self.assertEqual(cm.exception.code, "blocked")

    def test_webhook_signature(self):
        os.environ["QUARK_GW_FETCH_PRIVATE"] = "1"
        try:
            r = I.webhook({"url": self.base + "/hook", "secret": "s3cret", "event": "chat.completed", "data": {"a": 1}})
        finally:
            del os.environ["QUARK_GW_FETCH_PRIVATE"]
        self.assertTrue(r["delivered"])
        ts = LAST["headers"]["x-quark-timestamp"]
        exp = "sha256=" + hmac.new(b"s3cret", ts.encode() + b"." + LAST["body"], hashlib.sha256).hexdigest()
        self.assertEqual(LAST["headers"]["x-quark-signature"], exp)
        self.assertEqual(LAST["headers"]["x-quark-event"], "chat.completed")
        self.assertEqual(json.loads(LAST["body"])["data"], {"a": 1})
        with self.assertRaises(GatewayError):
            I.webhook({"url": self.base, "event": "nope"})
        with self.assertRaises(GatewayError):
            I.webhook({"url": "http://u:p@x.com", "event": "webhook.test"})


if __name__ == "__main__":
    unittest.main(verbosity=1)
