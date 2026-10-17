"""
تشغيل البوابة داخل تطبيق الأندرويد (Chaquopy).

يستدعيها MainActivity: تُشغّل خادم HTTP على 127.0.0.1 بمنفذ عشوائي (للبوابة فقط، بلا ملفات ثابتة)
وتحمي الوصول برمز عشوائي يُولَّد عند كل تشغيل للتطبيق، فلا يستطيع تطبيق آخر على الهاتف استخدامها.
"""
import http.server
import os
import secrets
import socketserver
import threading

# الرمز يُولَّد عند الاستيراد ويقرؤه http_api من متغير البيئة
_TOKEN = secrets.token_urlsafe(24)
os.environ["QUARK_GW_TOKEN"] = _TOKEN

from server.gateway import http_api, storage, tasks  # noqa: E402

_lock = threading.Lock()
_server = None


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if not http_api.handle(self, "GET"):
            self.send_error(404)

    def do_POST(self):
        if not http_api.handle(self, "POST"):
            self.send_error(404)

    def do_OPTIONS(self):
        if not http_api.handle(self, "OPTIONS"):
            self.send_error(404)

    def log_message(self, fmt, *args):
        pass


class _Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def start(data_dir=None):
    """يبدأ الخادم (مرة واحدة) ويعيد المنفذ. data_dir: مجلد التخزين الدائم داخل ملفات التطبيق الخاصة."""
    global _server
    with _lock:
        if _server is None:
            storage.configure(str(data_dir) if data_dir else None)
            _server = _Server(("127.0.0.1", 0), _Handler)
            threading.Thread(target=_server.serve_forever, daemon=True, name="quark-gw").start()
            tasks.start()
        return _server.server_address[1]


def token():
    return _TOKEN
