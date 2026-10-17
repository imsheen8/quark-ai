"""خادم Hugging Face وهمي للاختبار (بلا إنترنت): قائمة ملفات + بحث + تنزيل بدعم Range.
   python3 tests/mock_hf.py 8124      — أي مستودع يحتوي ثلاث صيغ؛ الأسماء التي تحوي slow تُبثّ ببطء."""
import http.server, json, re, socketserver, sys, time

def blob(n, seed=7):
    b = bytearray(n); b[:4] = b'GGUF'
    for i in range(4, n): b[i] = (i * seed) % 251
    return bytes(b)

SIZES = {'Q4_K_M': 3_000_000, 'Q8_0': 5_000_000, 'Q3_K_M': 2_200_000}
BLOBS = {q: blob(n, 3 + i) for i, (q, n) in enumerate(SIZES.items())}

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges')
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()
    def _json(self, o, code=200):
        d = json.dumps(o).encode(); self.send_response(code); self._cors()
        self.send_header('content-type', 'application/json'); self.send_header('content-length', str(len(d))); self.end_headers(); self.wfile.write(d)
    def do_GET(self):
        p = self.path.split('?')[0]
        m = re.match(r'^/api/models/([^/]+/[^/]+)/tree/main$', p)
        if m:
            repo = m.group(1)
            if 'missing' in repo: return self._json({'error': 'nf'}, 404)
            if 'private' in repo: return self._json({'error': 'auth'}, 401)
            name = repo.split('/')[1].replace('-GGUF', '')
            fl = [{'type': 'file', 'path': 'README.md', 'size': 100}]
            fl += [{'type': 'file', 'path': f'{name}-{q}.gguf', 'size': n, 'lfs': {'size': n}} for q, n in SIZES.items()]
            fl += [{'type': 'file', 'path': 'mmproj-F16.gguf', 'size': 800_000}]
            return self._json(fl)
        if p == '/api/models':
            return self._json([{'id': 'acme/Tiny-1B-GGUF', 'downloads': 12345, 'likes': 3}, {'id': 'acme/Big-7B-GGUF', 'downloads': 99}])
        m = re.match(r'^/([^/]+/[^/]+)/resolve/main/(.+\.gguf)$', p)
        if m:
            q = next((k for k in SIZES if k in m.group(2)), None)
            if not q: return self._json({'error': 'nf'}, 404)
            data = BLOBS[q]; start = 0; code = 200
            r = self.headers.get('Range')
            if r:
                start = int(re.match(r'bytes=(\d+)-', r).group(1)); code = 206
                if start >= len(data):
                    self.send_response(416); self._cors(); self.end_headers(); return
            body = data[start:]
            self.send_response(code); self._cors()
            self.send_header('content-length', str(len(body))); self.send_header('accept-ranges', 'bytes')
            if code == 206: self.send_header('content-range', f'bytes {start}-{len(data)-1}/{len(data)}')
            self.end_headers()
            slow = 'slow' in m.group(1)
            try:
                for i in range(0, len(body), 65536):
                    self.wfile.write(body[i:i + 65536])
                    if slow: time.sleep(0.03)
            except (BrokenPipeError, ConnectionResetError): pass
            return
        self._json({'error': 'nf'}, 404)

class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True; allow_reuse_address = True

if __name__ == '__main__':
    S(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8124), H).serve_forever()
