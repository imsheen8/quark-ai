"""اختبار التكاملات وWebhooks داخل مهام الخلفية (server/gateway/intbg.py): python3 tests/test_intbg.py"""
import hashlib
import hmac
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
TMP = tempfile.mkdtemp(prefix="quark-intbg-")
os.environ["QUARK_DATA_DIR"] = TMP
os.environ["QUARK_GW_FETCH_PRIVATE"] = "1"

from server.gateway import intbg, storage, tasks  # noqa: E402

storage.configure(TMP)
HITS, HOOKS = [], []


class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def do_GET(self):
        HITS.append(("GET", self.path, self.headers.get("Authorization")))
        b = json.dumps({"temp": 31}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n)
        if self.path.startswith("/hook"):
            HOOKS.append((dict(self.headers), body))
        else:
            HITS.append(("POST", self.path, None))
        self.send_response(200); self.send_header("Content-Length", "0"); self.end_headers()


SRV = HTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=SRV.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:%d" % SRV.server_address[1]
SYSTEMS, SCRIPT = [], []


def fake_llm(st, am, user, **kw):
    SYSTEMS.append(kw.get("system", ""))
    return SCRIPT.pop(0)(kw.get("messages") or [])


def wait(cond, secs=15):
    t0 = time.time()
    while time.time() - t0 < secs:
        v = cond()
        if v:
            return v
        time.sleep(0.1)


class T(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        storage.set_items({
            "ai_settings_v3": json.dumps({"endpoints": [{"id": "e1", "name": "m", "url": "http://x", "key": "k", "enabled": True, "kind": "api", "proto": "openai"}],
                                          "sel": {"ep": "e1", "model": "gpt-4o"}}),
            "ai_integrations_v1": json.dumps({"chat": True, "items": [{"id": "w1", "name": "الطقس", "enabled": True, "base_url": BASE, "auth_type": "bearer", "api_key": "TKN", "description": "GET /api/x"}],
                                              "hooks": [{"id": "h1", "name": "h", "url": BASE + "/hook", "secret": "sec", "events": ["chat.completed", "session.created"], "enabled": True, "text": True}]})})
        tasks.reload()
        tasks.start()
        cls.orig = tasks._llm
        tasks._llm = fake_llm

    @classmethod
    def tearDownClass(cls):
        tasks._llm = cls.orig

    def run_task(self, tid, calls):
        SCRIPT[:] = calls
        tasks.run_op("save", {"tasks": [{"id": tid, "name": tid, "prompt": "كم الحرارة؟", "output": "chat", "schedule": {"mode": "daily", "time": "09:00"}}]})
        tasks.run_op("run", {"id": tid})
        return wait(lambda: next((r for r in tasks.snapshot(0)["runs"] if r["taskId"] == tid and r["status"] in ("success", "error")), None))

    def test_api_call_loop_and_webhooks(self):
        HITS.clear(); HOOKS.clear(); SYSTEMS.clear()
        blk = '```api_call\n{"integration":"w1","method":"GET","path":"/api/x","params":{"q":"1"}}\n```'
        seen = []
        r = self.run_task("g1", [lambda m: blk, lambda m: (seen.append(m[-1]["content"]), "الحرارة 31")[1]])
        self.assertEqual(r["status"], "success", r)
        self.assertEqual(r["output"], "الحرارة 31")
        self.assertEqual(HITS, [("GET", "/api/x?q=1", "Bearer TKN")])
        self.assertIn("<api_result>", seen[0]); self.assertIn('"temp": 31', seen[0].replace('":31', '": 31'))
        self.assertIn("api_call", SYSTEMS[0]); self.assertIn("الطقس", SYSTEMS[0])
        self.assertTrue(r["apiCalls"][0].endswith("200"))
        wait(lambda: len(HOOKS) >= 2)
        evs = sorted(h[0].get("X-Quark-Event") for h in HOOKS)
        self.assertEqual(evs, ["chat.completed", "session.created"])
        hd, body = next(h for h in HOOKS if h[0].get("X-Quark-Event") == "chat.completed")
        exp = "sha256=" + hmac.new(b"sec", hd["X-Quark-Timestamp"].encode() + b"." + body, hashlib.sha256).hexdigest()
        self.assertEqual(hd["X-Quark-Signature"], exp)
        d = json.loads(body)["data"]
        self.assertEqual(d["text"], "الحرارة 31"); self.assertTrue(d["chat_id"])

    def test_mutation_refused_and_rounds_capped(self):
        HITS.clear()
        post = '```api_call\n{"integration":"w1","method":"POST","path":"/api/x","body":{"a":1}}\n```'
        seen = []
        r = self.run_task("g2", [lambda m: post, lambda m: (seen.append(m[-1]["content"]), "لم أنفّذ")[1]])
        self.assertEqual(r["status"], "success")
        self.assertEqual(HITS, [])
        self.assertIn("رُفض", seen[0])
        loop = lambda m: '```api_call\n{"integration":"w1","method":"GET","path":"/api/x"}\n```\nنص'
        r = self.run_task("g3", [loop] * (intbg.MAX_ROUNDS + 1))
        self.assertEqual(r["status"], "success")
        self.assertEqual(len(HITS), intbg.MAX_ROUNDS)
        self.assertNotIn("api_call", r["output"])

    def test_disabled_chat_flag_hides_integrations(self):
        d = json.loads(storage.get_items(["ai_integrations_v1"])["ai_integrations_v1"])
        d["chat"] = False
        storage.set_items({"ai_integrations_v1": json.dumps(d)})
        SYSTEMS.clear()
        r = self.run_task("g4", [lambda m: "عادي"])
        self.assertEqual(r["status"], "success")
        self.assertNotIn("api_call", SYSTEMS[0])
        d["chat"] = True
        storage.set_items({"ai_integrations_v1": json.dumps(d)})

    def test_parse_parity_with_js(self):
        cases = ['x ```api_call\n{"integration":"a","method":"get","path":"/p"}\n``` y', '```api_call\nnot json\n```', '```api_call\n{"path":"//evil"}\n```',
                 '```api_call\n{"method":"TRACE"}\n```', "لا شيء", '```api_call\n{"integration":"a","path":"/a b"}\n```', '```api_call\n[1]\n```',
                 '```api_call\n{"integration":"a","params":{"k":1},"body":{"z":2}}\n```']
        js = ("const fs=require('fs');const src=fs.readFileSync(%r,'utf8');const a=src.indexOf('function intParseCall'),b=src.indexOf('const intNeedsConfirm');"
              "const f=new Function(src.slice(a,b)+';return intParseCall')();const c=JSON.parse(fs.readFileSync(0,'utf8'));"
              "console.log(JSON.stringify(c.map(t=>{const r=f(t);return r&&(r.error?{error:r.error}:{call:r.call})})))") % os.path.join(HERE, "..", "js", "features", "integrations-engine.js")
        out = json.loads(subprocess.run(["node", "-e", js], input=json.dumps(cases), capture_output=True, text=True, check=True).stdout)
        py = []
        for t in cases:
            r = intbg.parse_call(t)
            py.append(r and ({"error": r["error"]} if r.get("error") else {"call": r["call"]}))
        self.assertEqual(py, out)


if __name__ == "__main__":
    unittest.main()
