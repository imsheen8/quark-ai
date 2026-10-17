"""اختبار مجدول المهام في بايثون (server/gateway/tasks.py): python3 tests/test_tasks.py"""
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

TMP = tempfile.mkdtemp(prefix="quark-tasks-")
os.environ["QUARK_DATA_DIR"] = TMP

import mock_upstream  # noqa: E402
import serve  # noqa: E402
from server.gateway import storage, tasks, web  # noqa: E402

storage.configure(TMP)
UP = mock_upstream.start()
GW = serve.Server(("127.0.0.1", 0), serve.H)
GW.daemon_threads = True
threading.Thread(target=GW.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:%d/api/gw/" % GW.server_address[1]
tasks.reload()
tasks.start()
EP = {"id": "e1", "url": "http://127.0.0.1:%d/openai/v1" % UP.server_address[1], "key": "sk-good", "proto": "openai", "kind": "api", "enabled": True}


def call(route, body):
    r = urllib.request.urlopen(urllib.request.Request(BASE + route, json.dumps(body).encode(), {"Content-Type": "application/json"}), timeout=20)
    return json.loads(r.read())


def wait(cond, secs=15):
    t0 = time.time()
    while time.time() - t0 < secs:
        v = cond()
        if v:
            return v
        time.sleep(0.1)
    return None


def ms(y, mo, d, h=0, mi=0, off=0):
    return int(datetime(y, mo, d, h, mi, tzinfo=timezone(timedelta(hours=off))).timestamp() * 1000)


class NextRun(unittest.TestCase):
    def setUp(self):
        tasks.set_timezone("", -180)                      # UTC+3 (بغداد)

    def t(self, **sch):
        return tasks.new_task({"schedule": dict(tasks.new_task()["schedule"], **sch)})

    def test_daily_local_time(self):
        frm = ms(2026, 10, 14, 7, 0, 3)                   # 07:00 محلي
        self.assertEqual(tasks.next_run(self.t(mode="daily", time="09:00"), frm), ms(2026, 10, 14, 9, 0, 3))
        frm = ms(2026, 10, 14, 10, 0, 3)
        self.assertEqual(tasks.next_run(self.t(mode="daily", time="09:00"), frm), ms(2026, 10, 15, 9, 0, 3))

    def test_interval_once_weekly_monthly(self):
        frm = ms(2026, 10, 14, 7, 0, 3)
        self.assertEqual(tasks.next_run(self.t(mode="interval", every=30), frm), frm + 30 * 60000)
        self.assertEqual(tasks.next_run(self.t(mode="once", date="2026-11-01", time="08:15"), frm), ms(2026, 11, 1, 8, 15, 3))
        # الأربعاء 14 أكتوبر 2026 → أقرب خميس (4) = 15
        self.assertEqual(tasks.next_run(self.t(mode="weekly", days=[4], time="09:00"), frm), ms(2026, 10, 15, 9, 0, 3))
        self.assertEqual(tasks.next_run(self.t(mode="monthly", day=31, time="09:00"), ms(2026, 10, 31, 10, 0, 3)), ms(2026, 11, 30, 9, 0, 3))

    def test_cron(self):
        frm = ms(2026, 10, 14, 7, 0, 3)
        self.assertEqual(tasks.next_run(self.t(mode="cron", cron="*/15 * * * *"), frm), ms(2026, 10, 14, 7, 15, 3))
        self.assertEqual(tasks.next_run(self.t(mode="cron", cron="30 8 * * 1-5"), frm), ms(2026, 10, 14, 8, 30, 3))
        self.assertIsNone(tasks.next_run(self.t(mode="cron", cron="bad"), frm))

    def test_event_has_no_schedule(self):
        t = tasks.new_task({"trigger": {"kind": "event", "name": "message", "count": 2, "counter": 0}})
        self.assertIsNone(tasks.next_run(t))


class Scheduler(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        storage.set_items({"ai_settings_v3": json.dumps({"endpoints": [EP], "sel": {"ep": "e1", "model": "gpt-4o"}, "systemPrompt": "sys"})})

    def sync(self):
        return call("tasks/sync", {"tz": "", "off": -180, "since": 0})

    def test_run_now_delivers_to_outbox_and_survives_without_client(self):
        call("tasks/save", {"tasks": [{"id": "t1", "name": "اختبار", "prompt": "مرحبا", "output": "chat", "schedule": {"mode": "daily", "time": "09:00"}}]})
        s = call("tasks/run", {"id": "t1"})
        r = wait(lambda: next((x for x in self.sync()["runs"] if x["taskId"] == "t1" and x["status"] == "success"), None))
        self.assertIsNotNone(r, "المهمة لم تُنفَّذ")
        self.assertEqual(r["output"], "plain answer")
        self.assertTrue(r["unread"])
        s = self.sync()
        ob = [o for o in s["outbox"] if o["id"] == r["id"]]
        self.assertEqual(len(ob), 1)
        self.assertEqual(ob[0]["chat"]["text"], "plain answer")
        self.assertFalse(ob[0]["chat"]["append"])
        u = ob[0]["usage"]
        self.assertEqual((len(u), u[0]["t"], u[0]["k"], u[0]["m"], u[0]["ok"], u[0]["i"], u[0]["o"]), (1, "t", "lab", "gpt-4o", True, 5, 7))
        t = next(x for x in s["tasks"] if x["id"] == "t1")
        self.assertEqual(t["runs"], 1)
        self.assertEqual(t["lastStatus"], "success")
        self.assertTrue(t["nextRun"] and t["nextRun"] > s["now"])
        # الصندوق الصادر يبقى حتى التأكيد
        self.assertTrue([o for o in self.sync()["outbox"] if o["id"] == r["id"]])
        call("tasks/ack", {"ids": [r["id"]]})
        self.assertFalse([o for o in self.sync()["outbox"] if o["id"] == r["id"]])
        # العلامات
        call("tasks/runs", {"patch": [{"id": r["id"], "unread": False}]})
        self.assertFalse(next(x for x in self.sync()["runs"] if x["id"] == r["id"])["unread"])

    def test_due_task_runs_by_itself(self):
        past = datetime.now().strftime("%Y-%m-%d")
        call("tasks/save", {"tasks": [{"id": "t2", "name": "مجدولة", "prompt": "x", "output": "notify", "schedule": {"mode": "once", "date": "2020-01-01", "time": "00:00"}}]})
        r = wait(lambda: next((x for x in self.sync()["runs"] if x["taskId"] == "t2" and x["status"] == "success"), None))
        self.assertIsNotNone(r, "المهمة المستحقة لم تعمل تلقائيًا")
        t = next(x for x in self.sync()["tasks"] if x["id"] == "t2")
        self.assertEqual(t["status"], "completed")
        self.assertIsNone(t["nextRun"])
        ob = [o for o in self.sync()["outbox"] if o["id"] == r["id"]]
        self.assertEqual(len(ob), 1)                                                      # notify: لا محادثة ولا تقرير، لكن الاستهلاك يصل للإحصائيات
        self.assertNotIn("chat", ob[0]); self.assertNotIn("research", ob[0]); self.assertTrue(ob[0]["usage"])

    def test_thread_output_appends(self):
        call("tasks/save", {"tasks": [{"id": "t3", "name": "خيط", "prompt": "p", "output": "thread", "schedule": {"mode": "daily", "time": "09:00"}}]})
        call("tasks/run", {"id": "t3"})
        wait(lambda: any(x["taskId"] == "t3" and x["status"] == "success" for x in self.sync()["runs"]))
        call("tasks/run", {"id": "t3"})
        wait(lambda: sum(1 for x in self.sync()["runs"] if x["taskId"] == "t3" and x["status"] == "success") == 2)
        ob = [o for o in self.sync()["outbox"] if o["taskId"] == "t3"]
        self.assertEqual(len(ob), 2)
        self.assertFalse(ob[0]["chat"]["append"])
        self.assertTrue(ob[1]["chat"]["append"])
        self.assertEqual(ob[0]["chat"]["id"], ob[1]["chat"]["id"])

    def test_memory_and_skills_injected_into_background_task(self):
        saved = storage.get_items(["ai_settings_v3"])["ai_settings_v3"]
        storage.set_items({"ai_memory_v1": json.dumps(MEMS), "ai_skills_v1": json.dumps(SKILLS), "ai_profile": json.dumps({"name": "أحمد", "prefs": "اختصر دائمًا"}),
                           "ai_settings_v3": json.dumps({"endpoints": [EP], "sel": {"ep": "e1", "model": "gpt-4o"}, "systemPrompt": "SYSMARK"})})
        try:
            mock_upstream.LOG.clear()
            call("tasks/save", {"tasks": [{"id": "t9", "name": "سياق", "prompt": "اكتب بريد إلكتروني رسمي لمديري عن الإجازة", "output": "chat"}]})
            call("tasks/run", {"id": "t9"})
            r = wait(lambda: next((x for x in self.sync()["runs"] if x["taskId"] == "t9" and x["status"] == "success"), None))
            self.assertIsNotNone(r)
            body = next(b for (m, p, h, b) in mock_upstream.LOG if m == "POST" and b and "chat/completions" in p)
            sysmsg = next(m["content"] for m in body["messages"] if m["role"] == "system")
            for needle in ("SYSMARK", "اسم المستخدم: أحمد", "اختصر دائمًا", "ذاكرة طويلة المدى", "موعد اجتماع الفريق", "مهارة: بريد مهني"):
                self.assertIn(needle, sysmsg)
            self.assertNotIn("مسودة", sysmsg)
            self.assertEqual(r["ctx"]["skills"], ["بريد مهني"])
            ob = next(o for o in self.sync()["outbox"] if o["id"] == r["id"])
            self.assertEqual(ob["chat"]["skills"], ["بريد مهني"])
            self.assertGreaterEqual(ob["chat"]["mem"], 1)
        finally:
            storage.set_items({"ai_settings_v3": saved, "ai_memory_v1": None, "ai_skills_v1": None, "ai_profile": None})

    def test_notifier_called_when_set(self):
        got = []

        class N:
            def onTaskDone(self, title, body):
                got.append((title, body))
        tasks.set_notifier(N())
        try:
            call("tasks/save", {"tasks": [{"id": "t8", "name": "إشعار", "prompt": "p", "output": "notify"}]})
            call("tasks/run", {"id": "t8"})
            self.assertTrue(wait(lambda: got))
            self.assertEqual(got[0], ("اكتملت المهمة: إشعار", "plain answer"))
        finally:
            tasks.set_notifier(None)

    def test_event_trigger_counter(self):
        call("tasks/save", {"tasks": [{"id": "t4", "name": "حدث", "prompt": "p", "output": "notify", "trigger": {"kind": "event", "name": "message", "count": 2}}]})
        call("tasks/emit", {"name": "message"})
        time.sleep(0.5)
        self.assertFalse([x for x in self.sync()["runs"] if x["taskId"] == "t4"])
        call("tasks/emit", {"name": "message"})
        self.assertIsNotNone(wait(lambda: next((x for x in self.sync()["runs"] if x["taskId"] == "t4" and x["status"] == "success"), None)))

    def test_missing_model_fails_and_autopauses(self):
        saved = storage.get_items(["ai_settings_v3"])["ai_settings_v3"]
        storage.set_items({"ai_settings_v3": json.dumps({"endpoints": [], "sel": None})})
        try:
            call("tasks/save", {"tasks": [{"id": "t5", "name": "فاشلة", "prompt": "p", "output": "notify"}]})
            for i in range(5):
                call("tasks/run", {"id": "t5"})
                wait(lambda: sum(1 for x in self.sync()["runs"] if x["taskId"] == "t5" and x["status"] == "error") == i + 1)
            t = next(x for x in self.sync()["tasks"] if x["id"] == "t5")
            self.assertEqual(t["fails"], 5)
            self.assertEqual(t["status"], "paused")
        finally:
            storage.set_items({"ai_settings_v3": saved})

    def test_client_cannot_overwrite_runtime_fields(self):
        call("tasks/save", {"tasks": [{"id": "t6", "name": "a", "prompt": "p", "output": "notify", "runs": 99, "fails": 4, "lastStatus": "x", "nextRun": 1}]})
        t = next(x for x in self.sync()["tasks"] if x["id"] == "t6")
        self.assertEqual((t["runs"], t["fails"], t["lastStatus"]), (0, 0, ""))
        self.assertNotEqual(t["nextRun"], 1)

    def test_pause_resume_and_delete(self):
        call("tasks/save", {"tasks": [{"id": "t7", "name": "a", "prompt": "p", "output": "notify"}]})
        call("tasks/save", {"tasks": [{"id": "t7", "status": "paused"}]})
        t = next(x for x in self.sync()["tasks"] if x["id"] == "t7")
        self.assertEqual((t["status"], t["nextRun"]), ("paused", None))
        call("tasks/save", {"tasks": [{"id": "t7", "status": "active"}]})
        self.assertTrue(next(x for x in self.sync()["tasks"] if x["id"] == "t7")["nextRun"])
        call("tasks/delete", {"ids": ["t7"]})
        self.assertFalse([x for x in self.sync()["tasks"] if x["id"] == "t7"])

    def test_persisted_in_db(self):
        raw = storage.get_items([tasks.K_TASKS])[tasks.K_TASKS]
        self.assertIn('"id":"t', raw)


MEMS = [{"id": "m%d" % i, "text": t, "cat": c, "pinned": p, "updatedAt": 1000 + i} for i, (t, c, p) in enumerate([
    ("اسمي أحمد وأعمل مهندس برمجيات في بغداد", "identity", False), ("أفضل الردود المختصرة بالعربية", "preference", False),
    ("أعمل على مشروع تطبيق للمحادثة بالذكاء الاصطناعي", "project", False), ("لدي سيارة تويوتا كامري موديل 2020", "fact", False),
    ("هدفي تعلم لغة الروست هذا العام", "goal", False), ("أخي سالم يعيش في البصرة", "contact", False),
    ("أحب القهوة العربية بدون سكر", "preference", False), ("أدرس الماجستير في الأمن السيبراني", "identity", False),
    ("أمتلك قطة اسمها لولو", "fact", False), ("موعد اجتماع الفريق كل أحد", "task", True), ("أستخدم لينكس في عملي", "fact", False)])]
SKILLS = [{"id": "s1", "name": "بريد مهني", "description": "صياغة بريد إلكتروني أو رسالة رسمية", "when": "عندما يطلب المستخدم كتابة بريد إلكتروني", "tags": ["بريد", "كتابة"], "body": "اكتب بريدًا مهذبًا", "status": "published"},
          {"id": "s2", "name": "تلخيص بنقاط", "description": "تلخيص نص طويل في نقاط", "when": "عندما يطلب المستخدم تلخيص مقال", "tags": ["تلخيص", "نقاط"], "body": "لخص", "status": "published"},
          {"id": "s3", "name": "مراجعة كود", "description": "مراجعة كود برمجي واكتشاف الأخطاء", "when": "عندما يلصق المستخدم كودًا", "tags": ["كود", "برمجة"], "body": "راجع", "status": "published"},
          {"id": "s4", "name": "مسودة", "description": "تلخيص مسودة", "when": "تلخيص", "tags": ["تلخيص"], "body": "x", "status": "draft"}]
QUERIES = ["اكتب لي بريدا إلكترونيا لمديري عن الإجازة", "لخّص هذا المقال الطويل في نقاط", "راجع الكود التالي واكتشف الأخطاء", "ما أفضل سيارة لي؟",
           "ما هو مشروعي الحالي؟", "كيف أتعلم الروست؟", "hello how are you", "أين يعيش أخي؟", "اقترح لي مشروبا", "Write an email to my boss"]


class ContextParity(unittest.TestCase):
    """منطق الذاكرة/المهارات في بايثون يطابق منطق الواجهة (JS) على نفس المدخلات."""

    def test_matches_js(self):
        import shutil as sh
        import subprocess
        from server.gateway import context
        if not sh.which("node"):
            self.skipTest("node غير متوفر")
        inp = {"memories": MEMS, "skills": SKILLS, "queries": QUERIES, "memCfg": {"enabled": True, "max": 4}, "skCfg": {"enabled": True, "max": 2, "sens": "balanced"}}
        r = subprocess.run(["node", os.path.join(os.path.dirname(__file__), "ctx_parity.js")], input=json.dumps(inp), capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        js = json.loads(r.stdout)
        for q, j in zip(QUERIES, js):
            self.assertEqual([m["id"] for m in context.mm_select(q, MEMS, inp["memCfg"])], j["mem"], q)
            self.assertEqual([s["name"] for s in context.sk_select(q, SKILLS, inp["skCfg"])], j["sk"], q)
            self.assertEqual(context.mm_tok(q), j["mt"], q)
            self.assertEqual(context.sk_tok(q), j["st"], q)
        self.assertTrue(any(j["sk"] for j in js) and any(j["mem"] for j in js))


class ClientJS(unittest.TestCase):
    def test_ui_engine_against_real_scheduler(self):
        import shutil as sh
        import subprocess
        if not sh.which("node"):
            self.skipTest("node غير متوفر")
        storage.set_items({"ai_settings_v3": json.dumps({"endpoints": [EP], "sel": {"ep": "e1", "model": "gpt-4o"}})})
        r = subprocess.run(["node", os.path.join(os.path.dirname(__file__), "test_tasks_server.js")], env=dict(os.environ, QUARK_TEST_BASE=BASE),
                           capture_output=True, text=True, timeout=90)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


class Research(unittest.TestCase):
    def test_research_task_end_to_end(self):
        storage.set_items({"ai_settings_v3": json.dumps({"endpoints": [EP], "sel": {"ep": "e1", "model": "gpt-4o"}, "research": {"runTimeout": 60}})})
        orig = (tasks._llm, web.run_search, web.fetch_page)
        calls = {"q": 0}

        def fake_llm(st, am, user, **kw):
            if "قسّم البحث" in user:
                return '{"category":"general","subtopics":["أ","ب"]}'
            if "استعلامات بحث قصيرة" in user:
                calls["q"] += 1
                return json.dumps(["query %d a" % calls["q"], "query %d b" % calls["q"]])
            if "استخرج ما يفيد" in user:
                return '{"relevant":true,"summary":"ملخص مفيد عن الموضوع","facts":["رقم 42"]}'
            if "حدّث التقرير" in user:
                return "ملاحظات: الرقم 42 [1] ومعلومة أخرى [2]. " * 5
            if "هل يكفي" in user:
                return '{"done":true,"gaps":[]}'
            return "# تقرير\n\nالخلاصة: الرقم 42 [1][2][99]. " * 6

        n = {"i": 0}

        def fake_search(body):
            n["i"] += 1
            return {"ok": True, "results": [{"title": "t%d%d" % (n["i"], k), "url": "https://site%d-%d.example/p" % (n["i"], k), "snippet": "snippet " * 30} for k in range(3)]}

        tasks._llm, web.run_search = fake_llm, fake_search
        web.fetch_page = lambda b: {"ok": True, "url": b["url"], "title": "عنوان", "text": "نص الصفحة " * 60, "image": ""}
        try:
            call("tasks/save", {"tasks": [{"id": "r1", "name": "بحث", "type": "research", "prompt": "ما هو الرقم؟", "output": "chat", "research": {"rounds": 2}}]})
            call("tasks/run", {"id": "r1"})
            r = wait(lambda: next((x for x in call("tasks/sync", {"since": 0})["runs"] if x["taskId"] == "r1" and x["status"] in ("success", "error")), None), 30)
            self.assertIsNotNone(r)
            self.assertEqual(r["status"], "success", r.get("error"))
            self.assertIn("## المصادر", r["output"])
            self.assertNotIn("[99]", r["output"])                    # رقم مصدر غير موجود يُحذف
            ob = next(o for o in call("tasks/sync", {})["outbox"] if o["id"] == r["id"])
            self.assertTrue(ob["research"]["sources"])
            self.assertEqual(ob["research"]["task"], "r1")
            self.assertEqual(r["researchId"], ob["research"]["id"])
        finally:
            tasks._llm, web.run_search, web.fetch_page = orig


def tearDownModule():
    tasks.shutdown()
    shutil.rmtree(TMP, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
