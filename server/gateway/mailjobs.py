"""
مهام البريد في الخلفية داخل الخادم: الإرسال المجدول والرد التلقائي — تعمل حتى لو كان التطبيق مغلقًا.

كانا في الواجهة (js/features/mail-engine.js: mlSchedTick / mlArTick) ويعملان أثناء فتح الصفحة فقط. الآن يعمل لهما خيط خاص
في الخادم (منفصل عن مجدول المهام كي لا يؤخّر أحدهما الآخر)، وتبقى الواجهة عارضًا يرسل الأوامر ويقرأ القائمة.

الملكية:
    المتصفح يملك:  ai_mail_v1 (الحسابات والتفضيلات ومنها إعداد الرد التلقائي) — الخادم يقرأه فقط
    الخادم يملك:   ai_mail_sched (الرسائل المجدولة)، ai_mail_arlog (سجل الردود لكل مرسل)، ai_mail_ar_state_v1 (baseline/at لكل حساب)
منطق القرار (mlAutoReplyDecision وغيره) منقول حرفيًا من الواجهة ويُقارَن بها في tests/test_mailjobs.py.
"""
from __future__ import annotations

import json
import re
import threading
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from . import mail, storage
from .errors import GatewayError

K_MAIL, K_SCHED, K_LOG, K_STATE = "ai_mail_v1", "ai_mail_sched", "ai_mail_arlog", "ai_mail_ar_state_v1"
KEYS = (K_SCHED, K_LOG, K_STATE)
POLL_EVERY = 120.0            # ثوانٍ بين فحوصات الوارد للرد التلقائي (مثل الواجهة)
GRACE_MS = 120_000            # مهلة قبل نسيان حالة حساب أُوقف ردّه (تتيح وصول الحفظ من المتصفح)
MAX_TRIES = 3
ML_DEF_AR = {"enabled": False, "start": "", "end": "", "subject": "(غائب) {subject}", "message": "شكرًا لرسالتك. أنا بعيد حاليًا وقد أتأخر في الرد.",
             "cooldown": "period", "excl": True, "pause": False, "baseline": 0, "at": 0}
ML_CD = {"1d": 1, "3d": 3, "7d": 7}

_lock = threading.RLock()
_sched: List[dict] = []
_log: Dict[str, Dict[str, int]] = {}
_state: Dict[str, dict] = {}
_loaded = False
_last_poll: Dict[str, float] = {}
_inbox: Dict[str, str] = {}
_thread: Optional[threading.Thread] = None


def _tasks():
    from . import tasks                                   # استيراد متأخر: tasks يستدعي هذه الوحدة أيضًا
    return tasks


def _now() -> int:
    return int(time.time() * 1000)


# ================================================================= منطق القرار (نقل حرفي من mail-engine.js)
def day_str(ms: Optional[int] = None) -> str:
    return _tasks()._local(_now() if ms is None else ms).strftime("%Y-%m-%d")


def is_day(v: Any) -> bool:
    return bool(re.match(r"^\d{4}-\d{2}-\d{2}$", str(v or "")))


def window_active(ar: dict, now_ms: Optional[int] = None) -> bool:
    if not ar or not ar.get("enabled"):
        return False
    t = day_str(now_ms)
    if is_day(ar.get("start")) and t < ar["start"]:
        return False
    if is_day(ar.get("end")) and t > ar["end"]:
        return False
    return True


def window_start_ms(ar: dict) -> int:
    if is_day(ar.get("start")):
        y, m, d = (int(x) for x in ar["start"].split("-"))
        return _tasks()._mk(y, m, d, 0, 0)
    return int(ar.get("at") or 0)


def _parse_ms(s: Any) -> Optional[int]:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            tz = _tasks()._tzinfo()
            dt = dt.replace(tzinfo=tz) if tz else dt
        return int(dt.timestamp() * 1000)
    except ValueError:
        return None


def decision(row: dict, ar: dict, ctx: dict) -> dict:
    def no(reason):
        return {"reply": False, "reason": reason}
    if not row or not row.get("uid") or row["uid"] <= int(ar.get("baseline") or 0):
        return no("old")
    if not row.get("unread"):
        return no("read")
    if row.get("draft"):
        return no("draft")
    addr = str((row.get("from") or {}).get("addr") or "").lower()
    if not addr or addr.find("@") < 1:
        return no("nosender")
    if addr in (ctx.get("self") or ()):
        return no("self")
    if ar.get("excl") is not False and row.get("auto"):
        return no("automated")
    t = _parse_ms(row.get("date"))
    if t is not None and t < window_start_ms(ar):
        return no("before-window")
    last = (ctx.get("log") or {}).get(addr)
    if last:
        if ar.get("cooldown") == "period":
            if last >= int(ar.get("at") or 0):
                return no("cooldown")
        elif ctx["now"] - last < ML_CD.get(ar.get("cooldown"), 1) * 86400000:
            return no("cooldown")
    return {"reply": True}


def auto_subject(tpl: Any, subject: Any) -> str:
    s = re.sub(r"[\r\n]+", " ", str(subject or "")).strip()
    out = re.sub(r"[\r\n]+", " ", str(tpl or "(غائب) {subject}").replace("{subject}", s)).strip()
    return out or ("Re: " + s)


# ================================================================= الحالة
def _load_json(raw: Optional[str], default):
    try:
        v = json.loads(raw) if raw else default
        return v if isinstance(v, type(default)) else default
    except ValueError:
        return default


def reload() -> None:
    global _sched, _log, _state, _loaded
    with _lock:
        it = storage.get_items(KEYS)
        _sched = [x for x in _load_json(it.get(K_SCHED), []) if isinstance(x, dict) and x.get("id")]
        _log = _load_json(it.get(K_LOG), {})
        _state = _load_json(it.get(K_STATE), {})
        _loaded = True


def _ensure() -> None:
    if not _loaded:
        reload()


def _save(*what: str) -> None:
    items: Dict[str, Optional[str]] = {}
    if "sched" in what:
        items[K_SCHED] = json.dumps(_sched, ensure_ascii=False, separators=(",", ":"))
    if "log" in what:
        items[K_LOG] = json.dumps(_log, ensure_ascii=False, separators=(",", ":"))
    if "state" in what:
        items[K_STATE] = json.dumps(_state, ensure_ascii=False, separators=(",", ":"))
    try:
        storage.set_items(items)
    except Exception:
        pass


def mail_config():
    """(حسابات مفعّلة {id: dict}، كل الحسابات، تفضيلات، هل قُرئت الإعدادات بنجاح) من ai_mail_v1 — قراءة فقط."""
    raw = storage.get_items([K_MAIL]).get(K_MAIL)
    d = _load_json(raw, {})
    ok = bool(raw) and isinstance(d.get("accounts"), list)
    accts: Dict[str, dict] = {}
    for a in d.get("accounts") or []:
        if isinstance(a, dict) and a.get("id") and a.get("user"):
            accts[str(a["id"])] = a
    return {k: a for k, a in accts.items() if a.get("enabled") is not False}, accts, (d.get("prefs") if isinstance(d.get("prefs"), dict) else {}), ok


def _creds(a: dict) -> dict:
    return {"imap_host": a.get("imap_host"), "imap_port": a.get("imap_port"), "imap_sec": a.get("imap_sec"), "smtp_host": a.get("smtp_host"),
            "smtp_port": a.get("smtp_port"), "smtp_sec": a.get("smtp_sec"), "user": a.get("user"), "pass": a.get("pass"),
            "from": a.get("from"), "display": a.get("display")}


def _call(op: str, a: dict, **params) -> dict:
    return mail.run(op, dict(params, acct=_creds(a)))


def _inbox_of(a: dict) -> str:
    """مجلد الوارد (يُكتشف من أدوار IMAP ويُخزَّن مؤقتًا)."""
    k = str(a["id"])
    if k not in _inbox:
        name = "INBOX"
        try:
            for f in _call("folders", a).get("folders") or []:
                if f.get("role") == "inbox":
                    name = f.get("name") or "INBOX"
                    break
        except GatewayError:
            return "INBOX"
        _inbox[k] = name
    return _inbox[k]


def _ar_of(prefs: dict, acc_id: str) -> dict:
    p = prefs.get(acc_id) if isinstance(prefs.get(acc_id), dict) else {}
    return dict(ML_DEF_AR, **(p.get("ar") if isinstance(p.get("ar"), dict) else {}))


def _notify(title: str, body: str) -> None:
    try:
        n = _tasks()._notifier
        if n is not None:
            n.onTaskDone(title, body)
    except Exception:
        pass


# ================================================================= الرد التلقائي
def arm(acc_id: str) -> dict:
    """يضبط الأساس = آخر رسالة موجودة الآن، فلا نردّ على القديم أبدًا (يُستدعى عند تفعيل الرد من الواجهة)."""
    _ensure()
    _, accts, _, _ = mail_config()
    a = accts.get(str(acc_id))
    if not a:
        raise GatewayError("الحساب غير موجود.", 404, "not_found")
    st = _call("status", a, folder=_inbox_of(a))
    with _lock:
        _state[str(acc_id)] = {"baseline": max(0, int(st.get("uidnext") or 1) - 1), "at": _now(), "touched": _now()}
        _save("state")
    return {"ok": True}


def disarm(acc_id: str) -> None:
    _ensure()
    with _lock:
        _state.pop(str(acc_id), None)
        _save("state")


def autoreply_tick(force: bool = False) -> None:
    _ensure()
    enabled, accts, prefs, ok = mail_config()
    now = _now()
    if not ok:
        return
    with _lock:
        stale = [k for k in _state if (k not in enabled or not _ar_of(prefs, k).get("enabled")) and now - int(_state[k].get("touched") or 0) > GRACE_MS]
        for k in stale:
            _state.pop(k, None)
        if stale:
            _save("state")
    self_addrs = {str(x).lower() for a in accts.values() for x in (a.get("user"), a.get("from")) if x}
    for acc_id, a in enabled.items():
        ar = _ar_of(prefs, acc_id)
        if not ar.get("enabled"):
            continue
        with _lock:
            st = _state.get(acc_id)
            if st is None:
                if ar.get("baseline"):                                # ترحيل: حالة كانت محفوظة في تفضيلات الواجهة قبل نقل الرد للخادم
                    st = _state[acc_id] = {"baseline": int(ar.get("baseline") or 0), "at": int(ar.get("at") or 0) or now, "touched": now}
                    _save("state")
            else:
                st["touched"] = now
        if st is None:
            try:
                arm(acc_id)
            except GatewayError:
                pass
            continue
        if not window_active(ar, now):
            continue
        if not force and time.time() - _last_poll.get(acc_id, 0) < POLL_EVERY:
            continue
        _last_poll[acc_id] = time.time()
        eff = dict(ar, baseline=int(st.get("baseline") or 0), at=max(int(st.get("at") or 0), int(ar.get("at") or 0)))
        try:
            rows = _call("list", a, folder=_inbox_of(a), filter="unread", after_uid=eff["baseline"], size=50).get("rows") or []
        except GatewayError:
            continue
        rows.sort(key=lambda r: r.get("uid") or 0)
        with _lock:
            log = _log.setdefault(acc_id, {})
        last_ok = eff["baseline"]
        for row in rows:
            d = decision(row, eff, {"self": self_addrs, "log": log, "now": now})
            if d["reply"]:
                try:
                    _call("send", a, to=[row["from"]["addr"]], subject=auto_subject(ar.get("subject"), row.get("subject")),
                          text=ar.get("message") or ML_DEF_AR["message"], in_reply_to=row.get("msgid"), auto_reply=True, save_sent=True,
                          reply_uid=row.get("uid"), reply_folder=_inbox_of(a))
                    with _lock:
                        log[str(row["from"]["addr"]).lower()] = _now()
                        _save("log")
                except GatewayError:
                    break                                           # فشل الإرسال: نعيد المحاولة لاحقًا من نفس الرسالة
            last_ok = max(last_ok, int(row.get("uid") or 0))
        if last_ok != eff["baseline"]:
            with _lock:
                st["baseline"] = last_ok
                _save("state")


# ================================================================= الإرسال المجدول
def _public(it: dict) -> dict:
    """نسخة للعرض: بلا محتوى المرفقات (قد يكون ضخمًا)."""
    p = dict(it.get("payload") or {})
    if p.get("attachments"):
        p["attachments"] = [{"name": x.get("name"), "type": x.get("type")} for x in p["attachments"] if isinstance(x, dict)]
    return dict({k: v for k, v in it.items() if k != "payload"}, payload=p)


def sched_list() -> List[dict]:
    with _lock:
        _ensure()
        return [_public(x) for x in sorted(_sched, key=lambda x: x.get("at") or 0)]


def sched_add(acc_id: Any, payload: Any, at: Any, sid: Any = None) -> dict:
    if not isinstance(payload, dict):
        raise GatewayError("payload غير صالح.", 400, "bad_request")
    try:
        at = int(at)
    except (TypeError, ValueError):
        raise GatewayError("وقت غير صالح.", 400, "bad_request")
    sid = str(sid) if isinstance(sid, str) and re.match(r"^[A-Za-z0-9_-]{1,40}$", sid) else "m" + _tasks().uid()[:8]
    with _lock:
        _ensure()
        _sched[:] = [x for x in _sched if x.get("id") != sid]
        it = {"id": sid, "accId": str(acc_id), "payload": payload, "at": at, "tries": 0}
        _sched.append(it)
        _save("sched")
    return _public(it)


def sched_cancel(sid: Any) -> None:
    with _lock:
        _ensure()
        _sched[:] = [x for x in _sched if x.get("id") != sid]
        _save("sched")


def account_removed(acc_id: Any) -> None:
    k = str(acc_id)
    with _lock:
        _ensure()
        _sched[:] = [x for x in _sched if x.get("accId") != k]
        _log.pop(k, None)
        _state.pop(k, None)
        _save("sched", "log", "state")


def sched_tick() -> None:
    _ensure()
    now = _now()
    with _lock:
        due = [x for x in _sched if x.get("at", 0) <= now and int(x.get("tries") or 0) < MAX_TRIES and int(x.get("nextTry") or 0) <= now]
    if not due:
        return
    _, accts, _, ok = mail_config()
    for it in due:
        a = accts.get(str(it.get("accId")))
        if not a:
            if ok:                                                    # الحساب حُذف فعلًا (لا مجرد فشل قراءة الإعدادات)
                sched_cancel(it["id"])
            continue
        subj = str((it.get("payload") or {}).get("subject") or "")[:80]
        try:
            _call("send", a, **{k: v for k, v in (it.get("payload") or {}).items() if k != "acct"})
            sched_cancel(it["id"])
            _notify("أُرسلت رسالة مجدولة", subj or "(بلا موضوع)")
        except GatewayError as e:
            with _lock:
                x = next((y for y in _sched if y.get("id") == it["id"]), None)
                if x:
                    x["tries"] = int(x.get("tries") or 0) + 1
                    x["nextTry"] = _now() + 60_000 * x["tries"]
                    x["err"] = e.message[:160]
                    _save("sched")
                    if x["tries"] >= MAX_TRIES:
                        _notify("تعذّر إرسال رسالة مجدولة", "%s — %s" % (subj, e.message[:100]))


# ================================================================= تنبيه البريد الجديد (إشعار أندرويد حين تكون الواجهة مغلقة)
CLIENT_QUIET = 180.0           # لا نُشعر إن كانت الواجهة تفحص البريد بنفسها (تعرض تنبيهها الخاص)
_ping = 0.0
_seen: Dict[str, tuple] = {}   # accId -> (uidnext, unseen)
_last_notify: Dict[str, float] = {}


def ping() -> None:
    """تستدعيه الواجهة عند كل فحص (tasks/mail_list): نعلم أنها مفتوحة فلا نكرر تنبيهها."""
    global _ping
    _ping = time.time()


def notify_tick(force: bool = False) -> None:
    if _tasks()._notifier is None:
        return
    enabled, _, prefs, ok = mail_config()
    if not ok:
        return
    for acc_id, a in enabled.items():
        if (prefs.get(acc_id) or {}).get("notify") is False:
            continue
        if not force and time.time() - _last_notify.get(acc_id, 0) < POLL_EVERY:
            continue
        _last_notify[acc_id] = time.time()
        try:
            folder = _inbox_of(a)
            st = _call("status", a, folder=folder)
        except GatewayError:
            continue
        nxt, uns = int(st.get("uidnext") or 0), int(st.get("unseen") or 0)
        prev = _seen.get(acc_id)
        _seen[acc_id] = (nxt, uns)
        if prev is None or nxt <= prev[0] or uns <= prev[1]:
            continue
        if time.time() - _ping < CLIENT_QUIET:
            continue
        ar = _ar_of(prefs, acc_id)
        if ar.get("pause") and window_active(ar):
            continue
        try:
            rows = _call("list", a, folder=folder, filter="unread", after_uid=prev[0] - 1, size=20).get("rows") or []
        except GatewayError:
            rows = []
        rows = [r for r in rows if (r.get("uid") or 0) >= prev[0] and not r.get("draft")]
        if not rows:
            continue
        r = max(rows, key=lambda x: x.get("uid") or 0)
        who = str((r.get("from") or {}).get("name") or (r.get("from") or {}).get("addr") or "")
        title = "بريد جديد" + (" — " + str(a.get("name")) if len(enabled) > 1 and a.get("name") else "")
        body = ("%s: %s" % (who, r.get("subject") or "(بلا موضوع)")) if len(rows) == 1 else "%d رسائل جديدة، آخرها من %s" % (len(rows), who)
        _notify(title, body[:160])


# ================================================================= الخيط
def _loop() -> None:
    t = _tasks()
    while not t._stop.is_set():
        try:
            sched_tick()
        except Exception:
            pass
        try:
            autoreply_tick()
        except Exception:
            pass
        try:
            notify_tick()
        except Exception:
            pass
        t._stop.wait(5.0)


def start() -> None:
    global _thread
    with _lock:
        if _thread and _thread.is_alive():
            return
        _thread = threading.Thread(target=_loop, daemon=True, name="quark-mailjobs")
        _thread.start()


OPS = ("mail_sched_add", "mail_sched_cancel", "mail_arm", "mail_disarm", "mail_account_removed")


def run_op(op: str, b: dict) -> None:
    if op == "mail_sched_add":
        sched_add(b.get("accId"), b.get("payload"), b.get("at"), b.get("id"))
    elif op == "mail_sched_cancel":
        sched_cancel(b.get("id"))
    elif op == "mail_arm":
        arm(str(b.get("accId") or ""))
    elif op == "mail_disarm":
        disarm(str(b.get("accId") or ""))
    elif op == "mail_account_removed":
        account_removed(b.get("accId"))
