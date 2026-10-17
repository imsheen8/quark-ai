# خادم QUARK AI المحلي: يقدّم ملفات التطبيق (بدون كاش) + بوابة النماذج /api/gw/*
#
#   python3 serve.py [المنفذ]            مثال: python3 serve.py 8000
#
# متغيرات اختيارية:
#   QUARK_GW_TOKEN=سر        رمز يطلبه الخادم من أي جهاز آخر (هاتف/شبكة) أو موقع آخر
#   QUARK_GW_LAN=1           السماح لأجهزة الشبكة المحلية بدون رمز
#   QUARK_GW_TIMEOUT=300     مهلة قراءة الرد (ثوانٍ)
#   QUARK_GW_INSECURE=1      تجاهل أخطاء شهادة HTTPS (لخوادم محلية بشهادة ذاتية)
#   QUARK_OLLAMA_CTX_CAP=16384  سقف نافذة السياق التي نطلبها من Ollama
#   QUARK_DATA_DIR=مسار      مجلد حفظ كل البيانات (المحادثات والإعدادات والصور). الافتراضي: data بجانب هذا الملف
import http.server, os, socketserver, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from server.gateway import http_api, storage, tasks  # noqa: E402


class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

    def do_GET(self):
        if not http_api.handle(self, 'GET'):
            super().do_GET()

    def do_HEAD(self):
        if not self.path.startswith(http_api.PREFIX):
            super().do_HEAD()
        else:
            self.send_error(405)

    def do_POST(self):
        if not http_api.handle(self, 'POST'):
            self.send_error(405, 'Method Not Allowed')

    def do_OPTIONS(self):
        if not http_api.handle(self, 'OPTIONS'):
            self.send_error(405, 'Method Not Allowed')

    def log_message(self, fmt, *args):
        if self.path.startswith(http_api.PREFIX) and self.command == 'GET':
            return                                  # لا نملأ السجل بفحوصات الجاهزية
        super().log_message(fmt, *args)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    data_dir = storage.configure()
    tasks.start()                                   # مجدول المهام: يعمل في الخلفية حتى بدون متصفح مفتوح
    with Server(('', port), H) as s:
        print(f'Open http://localhost:{port} in your browser (Ctrl+C to stop)')
        print('Data: ' + data_dir)
        print('Tasks: scheduler running in background (works with the browser closed)')
        print('Gateway: /api/gw/ ' + ('(token required for other devices)' if os.environ.get('QUARK_GW_TOKEN') else '(this device only)'))
        try:
            s.serve_forever()
        except KeyboardInterrupt:
            pass
