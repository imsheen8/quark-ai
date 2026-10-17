"""اختبار الإرسال المجدول والرد التلقائي في الخادم (server/gateway/mailjobs.py) مقابل خادمي IMAP/SMTP وهميين.

    python3 tests/test_mailjobs.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
TMP = tempfile.mkdtemp(prefix="quark-mj-")
os.environ["QUARK_DATA_DIR"] = TMP

import test_mail as tm  # noqa: E402
from server.gateway import mailjobs, storage, tasks  # noqa: E402

storage.configure(TMP)
tasks.set_timezone("UTC", None)
NOW = int(time.time() * 1000)


def put(accounts, prefs):
    storage.set_items({mailjobs.K_MAIL: json.dumps({"accounts": accounts, "prefs": prefs})})


class T(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.imap = tm.Srv(("127.0.0.1", 0), tm.IMAPH)
        cls.smtp = tm.Srv(("127.0.0.1", 0), tm.SMTPH)
        for s in (cls.imap, cls.smtp):
            threading.Thread(target=s.serve_forever, daemon=True).start()
        a = tm.acct(cls.imap.server_address[1], cls.smtp.server_address[1])
        cls.acc = dict(a, id="a1", name="x", enabled=True)

    def setUp(self):
        tm.STORE.__init__()
        tm.mail._pool.clear()
        mailjobs._inbox.clear()
        mailjobs._last_poll.clear()
        storage.wipe()
        mailjobs.reload()
        tm.STORE.add("INBOX", tm.raw_msg("Old <old@example.com>", "قديم", "x"))

    def ar(self, **kw):
        return {"a1": {"ar": dict({"enabled": True, "message": "غائب الآن", "cooldown": "period"}, **kw)}}

    def new(self, frm, subj, extra=""):
        return tm.STORE.add("INBOX", tm.raw_msg(frm, subj, "hello", extra=extra, date=time.strftime("%a, %d %b %Y %H:%M:%S +0000", time.gmtime(time.time() + 5))))

    # ---- تكافؤ المنطق مع الواجهة
    def test_parity_with_js(self):
        ars = [{"enabled": True, "start": "2026-10-01", "end": "2026-10-20", "at": NOW - 5000, "baseline": 3, "cooldown": "period"},
               {"enabled": True, "at": NOW - 86400000 * 2, "baseline": 0, "cooldown": "1d", "excl": False},
               {"enabled": False}, {"enabled": True, "end": "2026-10-10", "baseline": 1, "cooldown": "7d"}]
        rows = [{"uid": 5, "unread": True, "from": {"addr": "A@x.com"}, "date": "2026-10-14T10:00:00Z"},
                {"uid": 2, "unread": True, "from": {"addr": "a@x.com"}},
                {"uid": 9, "unread": False, "from": {"addr": "a@x.com"}},
                {"uid": 9, "unread": True, "draft": True, "from": {"addr": "a@x.com"}},
                {"uid": 9, "unread": True, "from": {"addr": "me@x.com"}},
                {"uid": 9, "unread": True, "auto": True, "from": {"addr": "n@x.com"}},
                {"uid": 9, "unread": True, "from": {"addr": "b@x.com"}, "date": "2020-01-01T00:00:00Z"},
                {"uid": 9, "unread": True, "from": {"addr": "bad"}}]
        logs = [{}, {"a@x.com": NOW - 1000}, {"a@x.com": NOW - 86400000 * 5}]
        cases, exp = [], []
        for ar in ars:
            cases.append({"k": "win", "ar": ar, "now": NOW})
            exp.append(mailjobs.window_active(ar, NOW))
            for r in rows:
                for lg in logs:
                    cases.append({"k": "dec", "row": r, "ar": ar, "self": ["me@x.com"], "log": lg, "now": NOW})
                    exp.append(mailjobs.decision(r, ar, {"self": {"me@x.com"}, "log": lg, "now": NOW})["reply"])
        for tpl, s in (("(غائب) {subject}", "a\r\nb"), ("", "x"), ("{subject}", ""), ("لا", "{subject}")):
            cases.append({"k": "sub", "tpl": tpl, "s": s})
            exp.append(mailjobs.auto_subject(tpl, s))
        out = subprocess.run(["node", os.path.join(HERE, "mail_parity.js")], input=json.dumps(cases), capture_output=True, text=True,
                             env=dict(os.environ, TZ="UTC"), check=True).stdout
        self.assertEqual(json.loads(out), exp)

    # ---- الرد التلقائي
    def test_autoreply_new_only_once_and_skips_automated(self):
        put([self.acc], self.ar())
        mailjobs.arm("a1")
        self.assertEqual(mailjobs._state["a1"]["baseline"], 1)
        self.new("Ali <ali@example.com>", "سؤال")
        self.new("Shop <noreply@shop.com>", "promo")
        mailjobs.autoreply_tick(force=True)
        sent = [b for b in tm.STORE.smtp_inbox]
        self.assertEqual(len(sent), 1)
        self.assertIn(b"ali@example.com", sent[0])
        self.assertEqual(mailjobs._state["a1"]["baseline"], 3)
        self.new("Ali <ali@example.com>", "ثانية")                  # نفس المرسل في نفس الفترة: لا ردّ ثانٍ
        mailjobs.autoreply_tick(force=True)
        self.assertEqual(len(tm.STORE.smtp_inbox), 1)
        self.assertIn("ali@example.com", mailjobs._log["a1"])

    def test_autoreply_arms_itself_without_replying_to_old(self):
        put([self.acc], self.ar())
        mailjobs.autoreply_tick(force=True)                       # أول فحص: يضبط الأساس فقط
        self.assertEqual(len(tm.STORE.smtp_inbox), 0)
        self.assertEqual(mailjobs._state["a1"]["baseline"], 1)

    def test_autoreply_off_or_outside_window_sends_nothing(self):
        put([self.acc], self.ar(enabled=False))
        mailjobs._state["a1"] = {"baseline": 0, "at": NOW, "touched": NOW}
        self.new("Ali <ali@example.com>", "x")
        mailjobs.autoreply_tick(force=True)
        put([self.acc], self.ar(end="2020-01-01"))
        mailjobs.autoreply_tick(force=True)
        self.assertEqual(len(tm.STORE.smtp_inbox), 0)

    # ---- الإرسال المجدول
    def test_scheduled_send_and_cancel(self):
        put([self.acc], {})
        p = {"to": ["x@y.com"], "subject": "مجدولة", "text": "hi"}
        mailjobs.sched_add("a1", p, NOW + 3_600_000, "s1")
        mailjobs.sched_add("a1", p, NOW - 1000, "s2")
        mailjobs.sched_add("a1", p, NOW + 7_200_000, "s3")
        mailjobs.sched_cancel("s3")
        mailjobs.sched_tick()
        self.assertEqual(len(tm.STORE.smtp_inbox), 1)
        self.assertEqual([x["id"] for x in mailjobs.sched_list()], ["s1"])
        mailjobs.reload()                                         # محفوظ في القاعدة
        self.assertEqual([x["id"] for x in mailjobs.sched_list()], ["s1"])

    def test_scheduled_failure_retries_then_stops(self):
        put([dict(self.acc, **{"pass": "wrong"})], {})
        mailjobs.sched_add("a1", {"to": ["x@y.com"], "subject": "s", "text": "t"}, NOW - 1000, "f1")
        for _ in range(5):
            mailjobs._sched[0]["nextTry"] = 0
            mailjobs.sched_tick()
        it = mailjobs._sched[0]
        self.assertEqual(it["tries"], mailjobs.MAX_TRIES)
        self.assertEqual(len(tm.STORE.smtp_inbox), 0)

    def test_removed_account_drops_its_jobs(self):
        put([self.acc], {})
        mailjobs.sched_add("a1", {"to": ["x@y.com"], "subject": "s", "text": "t"}, NOW + 10**7, "r1")
        mailjobs.account_removed("a1")
        self.assertEqual(mailjobs.sched_list(), [])

    def test_missing_account_config_does_not_delete_jobs(self):
        mailjobs.sched_add("a1", {"to": ["x@y.com"], "subject": "s", "text": "t"}, NOW - 1000, "k1")
        mailjobs.sched_tick()                                     # لا إعدادات بريد مقروءة بعد: نُبقي المهمة
        self.assertEqual(len(mailjobs.sched_list()), 1)

    # ---- تنبيه البريد الجديد
    def test_new_mail_notification(self):
        got = []

        class N:
            def onTaskDone(self, t, b): got.append((t, b))
        old = tasks._notifier
        tasks.set_notifier(N())
        try:
            put([self.acc], {})
            mailjobs._seen.clear(); mailjobs._ping = 0
            mailjobs.notify_tick(force=True)                       # أول فحص: يحفظ الحالة فقط
            self.assertEqual(got, [])
            self.new("Ali <ali@example.com>", "سؤال مهم")
            mailjobs.ping()                                         # الواجهة مفتوحة: لا تكرار
            mailjobs.notify_tick(force=True)
            self.assertEqual(got, [])
            self.new("Sara <sara@example.com>", "ثانية")
            mailjobs._ping = 0
            mailjobs.notify_tick(force=True)
            self.assertEqual(len(got), 1)
            self.assertIn("Sara", got[0][1])
            mailjobs.notify_tick(force=True)                        # لا جديد: لا تكرار
            self.assertEqual(len(got), 1)
            put([self.acc], {"a1": {"notify": False}})
            self.new("Z <z@example.com>", "x")
            mailjobs.notify_tick(force=True)
            self.assertEqual(len(got), 1)
        finally:
            tasks.set_notifier(old)

    def test_payload_attachments_not_exposed(self):
        mailjobs.sched_add("a1", {"to": ["x@y.com"], "attachments": [{"name": "f", "type": "t", "b64": "AAAA"}]}, NOW + 10**7, "p1")
        self.assertNotIn("b64", json.dumps(mailjobs.sched_list()))


if __name__ == "__main__":
    unittest.main()
