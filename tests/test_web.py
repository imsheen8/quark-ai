import os, sys, threading, unittest, http.server, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from server.gateway import web
from server.gateway.errors import GatewayError

PAGE = """<html><head><title>عنوان تجريبي</title><meta property="og:image" content="/i.png">
<meta name="description" content="وصف"></head><body><nav>قائمة</nav><article><h1>مرحبا</h1><p>فقرة أولى طويلة. """ + "نص " * 200 + """</p><ul><li>بند</li></ul></article>
<script>alert(1)</script><footer>تذييل</footer></body></html>"""

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/redir":
            self.send_response(302); self.send_header("Location", "http://169.254.169.254/"); self.end_headers(); return
        self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.end_headers()
        self.wfile.write(PAGE.encode())
    def log_message(self, *a): pass

class T(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = http.server.HTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]

    def test_extract(self):
        t, d, img, text = web.extract_text(PAGE)
        self.assertEqual(t, "عنوان تجريبي"); self.assertEqual(d, "وصف"); self.assertEqual(img, "/i.png")
        self.assertIn("# مرحبا", text); self.assertNotIn("alert", text); self.assertNotIn("تذييل", text); self.assertNotIn("قائمة", text)

    def test_private_blocked(self):
        with self.assertRaises(GatewayError) as e:
            web.fetch_page({"url": self.base + "/"})
        self.assertEqual(e.exception.code, "blocked")

    def test_fetch_allowed_and_redirect_blocked(self):
        os.environ["QUARK_GW_FETCH_PRIVATE"] = "1"
        try:
            r = web.fetch_page({"url": self.base + "/"})
            self.assertTrue(r["ok"]); self.assertTrue(r["image"].endswith("/i.png"))
        finally:
            del os.environ["QUARK_GW_FETCH_PRIVATE"]

    def test_bad_scheme(self):
        with self.assertRaises(GatewayError):
            web.fetch_page({"url": "file:///etc/passwd"})

    def test_search_needs_key(self):
        with self.assertRaises(GatewayError):
            web.run_search({"query": "x", "provider": "tavily"})

    def test_google_pse_needs_key_and_cx(self):
        with self.assertRaises(GatewayError):
            web.run_search({"query": "x", "provider": "google_pse"})
        with self.assertRaises(GatewayError) as e:
            web.run_search({"query": "x", "provider": "google_pse", "key": "k"})
        self.assertEqual(e.exception.code, "no_key")

    def test_ddg_parse(self):
        p = web._DDG()
        p.feed('<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fex.com%2Fa">عنوان</a><a class="result__snippet">ملخص</a>')
        r = web._norm(p.items, "title", "url", "snippet")
        self.assertEqual(r[0]["url"], "https://ex.com/a"); self.assertEqual(r[0]["snippet"], "ملخص")

if __name__ == "__main__":
    unittest.main()
