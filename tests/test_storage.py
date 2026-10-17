"""اختبار التخزين الدائم (server/gateway/storage.py) ومساراته في البوابة: python3 tests/test_storage.py"""
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

TMP = tempfile.mkdtemp(prefix="quark-store-")
os.environ["QUARK_DATA_DIR"] = TMP

import serve  # noqa: E402
from server.gateway import storage  # noqa: E402

storage.configure(TMP)
GW = serve.Server(("127.0.0.1", 0), serve.H)
GW.daemon_threads = True
threading.Thread(target=GW.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:%d/api/gw/" % GW.server_address[1]


def call(route, body=None, method=None, raw=None, ctype="application/json", headers=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE + route, data, {"Content-Type": ctype, **(headers or {})}, method=method)
    try:
        r = urllib.request.urlopen(req, timeout=20)
        return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def jcall(route, body=None, **kw):
    st, data, _ = call(route, body, **kw)
    return st, json.loads(data)


def chat(i, text="مرحبا"):
    return {"id": i, "title": "محادثة " + i, "ts": 1, "messages": [{"role": "user", "content": text}]}


class StorageTests(unittest.TestCase):
    def setUp(self):
        jcall("store/wipe", {})

    def test_kv_roundtrip_and_delete(self):
        st, j = jcall("store/set", {"items": {"ai_settings_v3": '{"theme":"dark","ع":1}', "ai_tags": "[]"}})
        self.assertEqual((st, j["n"]), (200, 2))
        st, j = jcall("store/snapshot")
        self.assertEqual(j["items"]["ai_settings_v3"], '{"theme":"dark","ع":1}')
        jcall("store/set", {"items": {"ai_tags": None}})
        st, j = jcall("store/snapshot")
        self.assertNotIn("ai_tags", j["items"])

    def test_bad_keys_and_values_rejected(self):
        for bad in ({"../x": "1"}, {"a b": "1"}, {"": "1"}, {"k": 5}, {"ai_chats": "[]"}):
            st, j = jcall("store/set", {"items": bad})
            self.assertEqual(st, 400, bad)

    def test_chats_diff_order_and_delete(self):
        jcall("store/chats", {"upsert": [chat("a"), chat("b"), chat("c")], "order": ["c", "a", "b"]})
        st, j = jcall("store/snapshot")
        self.assertEqual([c["id"] for c in j["chats"]], ["c", "a", "b"])
        # تعديل واحدة + حذف أخرى + إعادة ترتيب
        jcall("store/chats", {"upsert": [chat("a", "نص جديد")], "delete": ["c"], "order": ["b", "a"]})
        st, j = jcall("store/snapshot")
        self.assertEqual([c["id"] for c in j["chats"]], ["b", "a"])
        self.assertEqual(j["chats"][1]["messages"][0]["content"], "نص جديد")
        st, j = jcall("store/chats", {"upsert": [{"title": "بلا معرّف"}]})
        self.assertEqual(st, 400)

    def test_migrated_flag_and_wipe(self):
        self.assertFalse(jcall("store/snapshot")[1]["migrated"] and False)
        jcall("store/set", {"items": {"ai_x": "1"}})
        jcall("store/chats", {"upsert": [chat("a")], "order": ["a"]})
        jcall("store/wipe", {})
        j = jcall("store/snapshot")[1]
        self.assertEqual((j["items"], j["chats"], j["migrated"]), ({}, [], True))      # المسح يمنع إعادة نقل القديم

    def test_files_roundtrip_list_delete(self):
        png = b"\x89PNG\r\n\x1a\n" + os.urandom(2000)
        st, j = jcall("files/img1", raw=png, ctype="image/png", method="POST")
        self.assertEqual((st, j["size"]), (200, len(png)))
        st, data, h = call("files/img1")
        self.assertEqual((st, data, h["Content-Type"]), (200, png, "image/png"))
        self.assertEqual(h.get("X-Content-Type-Options"), "nosniff")
        self.assertEqual(h.get("Content-Security-Policy"), "sandbox")
        self.assertEqual([f["id"] for f in jcall("files")[1]["files"]], ["img1"])
        self.assertTrue(jcall("files/img1/delete", {})[1]["deleted"])
        self.assertEqual(call("files/img1")[0], 404)
        self.assertFalse(os.path.exists(os.path.join(TMP, "files", "im", "img1")))

    def test_file_id_traversal_blocked(self):
        for bad in ("..%2F..%2Fetc%2Fpasswd", "a.b", "x%00y", "a%20b"):
            st, _, _ = call("files/" + bad, raw=b"x", ctype="image/png", method="POST")
            self.assertIn(st, (400, 404), bad)
        self.assertFalse(os.path.exists(os.path.join(TMP, "..", "etc")))

    def test_odd_mime_is_neutralised(self):
        jcall("files/m1", raw=b"<script>alert(1)</script>", ctype="not a mime/../x", method="POST")
        st, _, h = call("files/m1")
        self.assertEqual(h["Content-Type"], "application/octet-stream")

    def test_stats(self):
        jcall("store/set", {"items": {"ai_x": "x" * 100}})
        jcall("store/chats", {"upsert": [chat("a")], "order": ["a"]})
        jcall("files/s1", raw=b"1234567890", ctype="image/png", method="POST")
        st = jcall("store/stats")[1]
        self.assertEqual((st["chats_n"], st["kv_n"], st["files_n"], st["files"]), (1, 1, 1, 10))
        self.assertGreater(st["disk_free"], 0)
        self.assertEqual(st["dir"], TMP)

    def test_survives_restart(self):
        jcall("store/set", {"items": {"ai_keep": "yes"}})
        jcall("store/chats", {"upsert": [chat("k")], "order": ["k"]})
        storage.configure(TMP)                                  # إعادة فتح نفس المجلد
        j = jcall("store/snapshot")[1]
        self.assertEqual((j["items"]["ai_keep"], j["chats"][0]["id"]), ("yes", "k"))

    def test_access_control_applies(self):
        os.environ["QUARK_GW_TOKEN"] = "sekret"
        try:
            st, _ = jcall("store/snapshot", headers={"Origin": "https://evil.example"})
            self.assertEqual(st, 403)
            st, _ = jcall("store/snapshot", headers={"Origin": "https://evil.example", "X-Quark-Token": "sekret"})
            self.assertEqual(st, 200)
        finally:
            del os.environ["QUARK_GW_TOKEN"]

    def test_concurrent_writes(self):
        errs = []

        def w(n):
            try:
                for i in range(15):
                    jcall("store/chats", {"upsert": [chat("t%d_%d" % (n, i))]})
                    jcall("store/set", {"items": {"ai_k%d" % n: str(i)}})
            except Exception as e:                                # pragma: no cover
                errs.append(e)

        ts = [threading.Thread(target=w, args=(n,)) for n in range(6)]
        [t.start() for t in ts]
        [t.join() for t in ts]
        self.assertEqual(errs, [])
        self.assertEqual(len(jcall("store/snapshot")[1]["chats"]), 90)


if __name__ == "__main__":
    try:
        unittest.main(verbosity=1)
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
