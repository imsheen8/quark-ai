"""
البريد الإلكتروني: عمليات IMAP / SMTP للبوابة (مكتبة بايثون القياسية فقط).

كل طلب يحمل بيانات الحساب (acct) وتبقى في المتصفح؛ الخادم لا يخزّنها ولا يسجّلها.
العمليات (POST /api/gw/mail/<op>):
  test  folders  status  list  read  attachment  send  draft
  mark  move  delete  archive  unsub_scan  unsub_exec  sent_samples

مبادئ:
  - كل تعامل مع الرسائل بالـ UID لا بأرقام التسلسل، وأي UID مفقود يُتجاهل بأمان.
  - القراءة بـ BODY.PEEK فلا تُعلَّم الرسالة مقروءة إلا بطلب صريح.
  - أسماء المجلدات تُقتبس وتُرمَّز بـ modified UTF-7، وأي حقل فيه CR/LF يُرفض.
  - أي رابط إلغاء اشتراك يمر على حماية الشبكة الداخلية نفسها المستخدمة في جلب الصفحات.
"""
from __future__ import annotations

import base64
import email
import email.policy
import email.utils
import hashlib
import imaplib
import ipaddress
import re
import smtplib
import socket
import ssl
import threading
import time
import urllib.parse
from contextlib import contextmanager
from datetime import datetime, timezone
from email.header import decode_header, make_header
from email.message import EmailMessage
from typing import Dict, List, Optional, Tuple

from .errors import GatewayError
from .transport import ssl_context

TIMEOUT = 25.0
POOL_IDLE = 90.0
MAX_LIST = 100
MAX_ATTACH = 25 * 1024 * 1024
MAX_BODY_CHARS = 400_000
MAX_INLINE_TOTAL = 2 * 1024 * 1024
BLOCKED_HOSTS = {"169.254.169.254", "metadata.google.internal", "100.100.100.200", "fd00:ec2::254"}
imaplib._MAXLINE = 20_000_000  # رسائل كبيرة


def _err(msg: str, status: int = 400, code: str = "mail_error") -> GatewayError:
    return GatewayError(msg, status, code)


# ------------------------------------------------------------------ تحقق مدخلات
def _clean_line(v, name: str = "", limit: int = 998) -> str:
    s = "" if v is None else str(v)
    if "\r" in s or "\n" in s or "\x00" in s:
        raise _err("قيمة غير صالحة في الحقل %s." % (name or ""), 400, "bad_input")
    return s.strip()[:limit]


def _check_host(host: str) -> str:
    host = _clean_line(host, "الخادم", 255).lower()
    if not host or re.search(r"[\s/\\@]", host):
        raise _err("عنوان الخادم غير صالح.", 400, "bad_host")
    if host in BLOCKED_HOSTS:
        raise _err("عنوان الخادم محجوب.", 403, "blocked")
    try:
        ip = ipaddress.ip_address(host.strip("[]"))
        if ip.is_link_local:
            raise _err("عنوان الخادم محجوب.", 403, "blocked")
    except ValueError:
        pass
    return host


def _port(v, default: int) -> int:
    try:
        p = int(v)
    except (TypeError, ValueError):
        return default
    return p if 1 <= p <= 65535 else default


def _sec(v, default: str = "ssl") -> str:
    v = str(v or default).lower()
    return v if v in ("ssl", "starttls", "none") else default


class Acct:
    def __init__(self, a: dict):
        if not isinstance(a, dict):
            raise _err("بيانات الحساب مفقودة.", 400, "bad_input")
        self.user = _clean_line(a.get("user"), "اسم المستخدم", 320)
        self.password = str(a.get("pass") or "")
        if "\r" in self.password or "\n" in self.password:
            raise _err("كلمة المرور غير صالحة.", 400, "bad_input")
        self.imap_host = _check_host(a.get("imap_host")) if a.get("imap_host") else ""
        self.imap_port = _port(a.get("imap_port"), 993)
        self.imap_sec = _sec(a.get("imap_sec"), "ssl")
        self.smtp_host = _check_host(a.get("smtp_host")) if a.get("smtp_host") else ""
        self.smtp_port = _port(a.get("smtp_port"), 465)
        self.smtp_sec = _sec(a.get("smtp_sec"), "ssl")
        self.from_addr = _clean_line(a.get("from") or self.user, "عنوان المرسل", 320)
        self.display = _clean_line(a.get("display"), "الاسم", 120)
        if not self.user:
            raise _err("اسم المستخدم مطلوب.", 400, "bad_input")

    def key(self) -> str:
        raw = "|".join((self.imap_host, str(self.imap_port), self.imap_sec, self.user, self.password))
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ------------------------------------------------------------------ ترجمة أخطاء الشبكة
def _net_error(e: Exception, what: str = "الخادم") -> GatewayError:
    if isinstance(e, GatewayError):
        return e
    if isinstance(e, (imaplib.IMAP4.error, smtplib.SMTPAuthenticationError)):
        t = str(e)
        low = t.lower()
        if any(k in low for k in ("authenticat", "login", "invalid credentials", "auth", "password", "username")):
            return _err("رفض %s اسم المستخدم أو كلمة المرور. في Gmail وiCloud وOutlook استخدم «كلمة مرور التطبيق»." % what, 401, "auth")
        return _err("خطأ من %s: %s" % (what, t[:160]), 502, "protocol")
    if isinstance(e, ssl.SSLError):
        return _err("فشل التحقق من شهادة %s. إن كان الخادم محليًا بشهادة ذاتية فعّل QUARK_GW_INSECURE=1." % what, 502, "ssl")
    if isinstance(e, socket.timeout) or isinstance(e, TimeoutError):
        return _err("انتهت مهلة الاتصال بـ%s." % what, 504, "timeout")
    if isinstance(e, socket.gaierror):
        return _err("تعذّر العثور على %s. تحقق من العنوان." % what, 502, "dns")
    if isinstance(e, ConnectionRefusedError):
        return _err("رفض %s الاتصال. تحقق من المنفذ ونوع الأمان." % what, 502, "refused")
    if isinstance(e, smtplib.SMTPRecipientsRefused):
        return _err("رفض الخادم أحد المستلمين.", 422, "recipient")
    if isinstance(e, smtplib.SMTPException):
        return _err("خطأ في الإرسال: %s" % str(e)[:160], 502, "smtp")
    if isinstance(e, OSError):
        return _err("تعذّر الاتصال بـ%s: %s" % (what, str(e)[:100] or e.__class__.__name__), 502, "network")
    return _err("خطأ غير متوقع: %s" % str(e)[:160], 500, "internal")


# ------------------------------------------------------------------ IMAP: اتصال وتجميع
def _imap_connect(a: Acct) -> imaplib.IMAP4:
    if not a.imap_host:
        raise _err("خادم IMAP غير مضبوط.", 400, "bad_input")
    try:
        if a.imap_sec == "ssl":
            c = imaplib.IMAP4_SSL(a.imap_host, a.imap_port, ssl_context=ssl_context(), timeout=TIMEOUT)
        else:
            c = imaplib.IMAP4(a.imap_host, a.imap_port, timeout=TIMEOUT)
            if a.imap_sec == "starttls":
                c.starttls(ssl_context=ssl_context())
        try:
            c.login(a.user, a.password)
        except Exception:
            try:
                c.shutdown()
            except Exception:
                pass
            raise
        return c
    except Exception as e:
        raise _net_error(e, "خادم IMAP")


class _Slot:
    def __init__(self):
        self.lock = threading.Lock()
        self.conn: Optional[imaplib.IMAP4] = None
        self.last = 0.0
        self.sel: Optional[str] = None


_pool: Dict[str, _Slot] = {}
_pool_lock = threading.Lock()


def _slot(a: Acct) -> _Slot:
    now = time.time()
    with _pool_lock:
        for k in [k for k, s in _pool.items() if s.conn and now - s.last > POOL_IDLE * 3 and not s.lock.locked()]:
            s = _pool.pop(k)
            _drop(s)
        return _pool.setdefault(a.key(), _Slot())


def _drop(s: _Slot) -> None:
    c, s.conn, s.sel = s.conn, None, None
    if c:
        try:
            c.logout()
        except Exception:
            try:
                c.shutdown()
            except Exception:
                pass


@contextmanager
def imap(a: Acct):
    """يعير اتصالًا حيًّا (يُعاد استخدامه 90 ثانية)؛ أي خطأ يُسقط الاتصال."""
    s = _slot(a)
    with s.lock:
        try:
            if s.conn is not None and time.time() - s.last > POOL_IDLE:
                _drop(s)
            if s.conn is not None:
                try:
                    s.conn.noop()
                except Exception:
                    _drop(s)
            if s.conn is None:
                s.conn = _imap_connect(a)
                s.sel = None
            yield s
            s.last = time.time()
        except GatewayError:
            _drop(s)
            raise
        except Exception as e:
            _drop(s)
            raise _net_error(e, "خادم IMAP")


# ------------------------------------------------------------------ أسماء المجلدات (modified UTF-7)
def utf7_decode(s: str) -> str:
    def rep(m):
        b = m.group(1)
        if b == "":
            return "&"
        b = b.replace(",", "/")
        b += "=" * (-len(b) % 4)
        try:
            return base64.b64decode(b).decode("utf-16-be")
        except Exception:
            return m.group(0)
    return re.sub(r"&([^-]*)-", rep, s)


def utf7_encode(s: str) -> str:
    out, buf = [], ""

    def flush():
        nonlocal buf
        if buf:
            b = base64.b64encode(buf.encode("utf-16-be")).decode("ascii").rstrip("=").replace("/", ",")
            out.append("&" + b + "-")
            buf = ""
    for ch in s:
        if 0x20 <= ord(ch) <= 0x7E:
            flush()
            out.append("&-" if ch == "&" else ch)
        else:
            buf += ch
    flush()
    return "".join(out)


def _q(name: str) -> str:
    """يقتبس اسم مجلد لاستخدامه في أمر IMAP."""
    name = _clean_line(name, "المجلد", 300)
    if not name:
        raise _err("اسم المجلد فارغ.", 400, "bad_input")
    return '"' + name.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _select(s: _Slot, folder: str, readonly: bool = True) -> int:
    key = "%s|%d" % (folder, 1 if readonly else 0)
    if s.sel != key:
        typ, data = s.conn.select(_q(folder), readonly=readonly)
        if typ != "OK":
            s.sel = None
            raise _err("تعذّر فتح المجلد «%s»." % utf7_decode(folder), 404, "no_folder")
        s.sel = key
        try:
            return int(data[0])
        except Exception:
            return 0
    return 0


# ------------------------------------------------------------------ مجلدات
_ROLE_FLAGS = {"\\inbox": "inbox", "\\sent": "sent", "\\drafts": "drafts", "\\trash": "trash",
               "\\junk": "junk", "\\archive": "archive", "\\all": "all", "\\flagged": "flagged"}
_ROLE_NAMES = {
    "inbox": ("inbox", "وارد", "الوارد"),
    "sent": ("sent", "sent items", "sent mail", "sent messages", "المرسل", "المرسلة", "البريد المرسل", "العناصر المرسلة"),
    "drafts": ("drafts", "draft", "المسودات", "مسودات"),
    "trash": ("trash", "deleted", "deleted items", "deleted messages", "bin", "المحذوفات", "المهملات", "سلة المحذوفات"),
    "junk": ("junk", "spam", "junk e-mail", "junk email", "bulk mail", "الرسائل غير المرغوبة", "غير مرغوب", "السبام"),
    "archive": ("archive", "archives", "الأرشيف"),
}
_LIST_RE = re.compile(rb'\((?P<flags>[^)]*)\) (?P<delim>"(?:[^"\\]|\\.)*"|NIL) (?P<name>.+)$')


def _parse_list_line(raw: bytes) -> Optional[dict]:
    m = _LIST_RE.match(raw.strip())
    if not m:
        return None
    flags = m.group("flags").decode("ascii", "ignore").lower().split()
    if "\\noselect" in flags or "\\nonexistent" in flags:
        return None
    nm = m.group("name").strip()
    if nm.startswith(b'"') and nm.endswith(b'"'):
        nm = nm[1:-1].replace(b'\\"', b'"').replace(b"\\\\", b"\\")
    name = nm.decode("utf-8", "replace")
    delim = m.group("delim").decode("ascii").strip('"')
    role = next((_ROLE_FLAGS[f] for f in flags if f in _ROLE_FLAGS), "")
    return {"name": name, "label": utf7_decode(name), "delim": "" if delim == "NIL" else delim, "role": role}


def list_folders(a: Acct) -> List[dict]:
    with imap(a) as s:
        typ, data = s.conn.list()
        if typ != "OK":
            raise _err("تعذّر جلب المجلدات.", 502, "protocol")
        rows = []
        for item in data or []:
            if isinstance(item, tuple):
                item = item[0] + b" " + item[1]
            if not isinstance(item, (bytes, bytearray)):
                continue
            r = _parse_list_line(bytes(item))
            if r:
                rows.append(r)
    for r in rows:
        if r["name"].upper() == "INBOX":
            r["role"] = "inbox"
    seen = {r["role"] for r in rows if r["role"]}
    for r in rows:
        if r["role"]:
            continue
        leaf = r["label"].split(r["delim"])[-1] if r["delim"] else r["label"]
        low = leaf.strip().lower()
        for role, names in _ROLE_NAMES.items():
            if low in names and role not in seen:
                r["role"] = role
                seen.add(role)
                break
    order = {"inbox": 0, "drafts": 1, "sent": 2, "archive": 3, "all": 4, "junk": 5, "trash": 6, "flagged": 7, "": 9}
    rows.sort(key=lambda r: (order.get(r["role"], 9), r["label"].lower()))
    return rows


def role_folder(a: Acct, role: str) -> Optional[str]:
    for r in list_folders(a):
        if r["role"] == role:
            return r["name"]
    return None


def folder_status(a: Acct, folder: str) -> dict:
    with imap(a) as s:
        typ, data = s.conn.status(_q(folder), "(MESSAGES UNSEEN UIDNEXT UIDVALIDITY)")
        if typ != "OK" or not data or not data[0]:
            raise _err("تعذّر قراءة حالة المجلد.", 404, "no_folder")
        txt = data[0].decode("utf-8", "replace") if isinstance(data[0], bytes) else str(data[0])
        out = {}
        for k in ("MESSAGES", "UNSEEN", "UIDNEXT", "UIDVALIDITY"):
            m = re.search(k + r"\s+(\d+)", txt)
            out[k.lower()] = int(m.group(1)) if m else 0
        return out


def folders_with_counts(a: Acct) -> List[dict]:
    rows = list_folders(a)
    for r in rows:
        if r["role"] in ("inbox", "drafts", "junk") or r["name"].upper() == "INBOX":
            try:
                st = folder_status(a, r["name"])
                r["unseen"], r["total"] = st["unseen"], st["messages"]
            except GatewayError:
                pass
    return rows


# ------------------------------------------------------------------ ترويسات وأدوات تحليل
def dh(v) -> str:
    """يفك ترميز ترويسة RFC 2047، ويتحمّل الترويسات الخام بـ UTF-8 التي يرسلها بعض الخوادم."""
    if v is None:
        return ""
    s = str(v)
    try:
        s = s.encode("ascii", "surrogateescape").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    try:
        return str(make_header(decode_header(s))).strip()
    except Exception:
        return s.strip()


def addr_list(v) -> List[dict]:
    out = []
    for name, addr in email.utils.getaddresses([dh(v)] if v else []):
        if addr:
            out.append({"name": dh(name), "addr": addr.strip()})
    return out


def iso_date(v) -> str:
    try:
        d = email.utils.parsedate_to_datetime(str(v))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return ""


def parse_unsub(v: str, post: str = "") -> dict:
    """يقرأ List-Unsubscribe: روابط mailto وhttp(s) وهل يدعم النقرة الواحدة (RFC 8058)."""
    v = dh(v)
    out = {"mailto": "", "http": "", "oneclick": False}
    for u in re.findall(r"<([^>]+)>", v):
        u = u.strip()
        low = u.lower()
        if low.startswith("mailto:") and not out["mailto"]:
            out["mailto"] = u
        elif low.startswith(("http://", "https://")) and not out["http"]:
            out["http"] = u
    out["oneclick"] = bool(out["http"] and "list-unsubscribe=one-click" in (post or "").lower().replace(" ", ""))
    return out


_AUTO_ADDR = re.compile(r"(^|[._+-])(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce[sd]?|notifications?)([._+@-]|$)", re.I)


def is_automated(h: dict) -> bool:
    """هل الرسالة آلية/نشرة (لا تُرَدّ عليها آليًا)؟"""
    get = lambda k: (h.get(k) or "").strip().lower()
    if get("auto-submitted") not in ("", "no"):
        return True
    if get("precedence") in ("bulk", "list", "junk", "auto_reply"):
        return True
    if h.get("list-id") or h.get("list-unsubscribe") or h.get("x-auto-response-suppress"):
        return True
    frm = email.utils.parseaddr(dh(h.get("from")))[1]
    return bool(_AUTO_ADDR.search(frm or ""))


_HDR_FIELDS = ("FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES REPLY-TO LIST-UNSUBSCRIBE LIST-UNSUBSCRIBE-POST "
               "LIST-ID AUTO-SUBMITTED PRECEDENCE X-AUTO-RESPONSE-SUPPRESS")


def _raw_headers(hdr: bytes) -> Dict[str, str]:
    """ترويسات خام كنصوص (تحتفظ بالبايتات غير ASCII عبر surrogateescape ليفكّها dh لاحقًا)."""
    msg = email.message_from_bytes(hdr, policy=email.policy.compat32)
    out: Dict[str, str] = {}
    for k, v in msg.raw_items():
        out.setdefault(k.lower(), str(v))
    return out


def _fetch_items(data) -> List[Tuple[str, bytes]]:
    """يجمع ردّ FETCH إلى أزواج (نص البيانات الوصفية، بايتات الحرفية). بعض الخوادم تضع
    FLAGS/BODYSTRUCTURE بعد الحرفية، فنلحق البايتات التالية بالبيانات الوصفية."""
    out: List[Tuple[str, bytes]] = []
    for item in data or []:
        if isinstance(item, tuple):
            meta = item[0].decode("utf-8", "replace") if isinstance(item[0], bytes) else str(item[0])
            out.append((meta, item[1] or b""))
        elif isinstance(item, (bytes, bytearray)) and out:
            tail = bytes(item).decode("utf-8", "replace")
            if tail.strip() not in ("", ")"):
                out[-1] = (out[-1][0] + " " + tail, out[-1][1])
    return out


def _parse_fetch(data) -> List[dict]:
    """يحوّل ردّ UID FETCH (FLAGS + BODYSTRUCTURE + ترويسات) إلى صفوف."""
    rows = []
    for mm, hdr in _fetch_items(data):
        um = re.search(r"UID (\d+)", mm)
        if not um:
            continue
        fm = re.search(r"FLAGS \(([^)]*)\)", mm)
        flags = [f.lower() for f in (fm.group(1).split() if fm else [])]
        h = _raw_headers(hdr)
        frm = addr_list(h.get("from"))
        att = bool(re.search(r'"attachment"|\("(?:file)?name"', mm, re.I)) or \
            bool(re.search(r'BODYSTRUCTURE.*?\("(?:application|audio|video)"', mm, re.I))
        unsub = parse_unsub(h.get("list-unsubscribe", ""), h.get("list-unsubscribe-post", ""))
        rows.append({
            "uid": int(um.group(1)),
            "from": frm[0] if frm else {"name": "", "addr": ""},
            "to": addr_list(h.get("to")),
            "cc": addr_list(h.get("cc")),
            "subject": dh(h.get("subject")) or "",
            "date": iso_date(h.get("date")),
            "unread": "\\seen" not in flags,
            "flagged": "\\flagged" in flags,
            "answered": "\\answered" in flags,
            "draft": "\\draft" in flags,
            "att": att,
            "msgid": h.get("message-id", "").strip(),
            "auto": is_automated(h),
            "unsub": bool(unsub["mailto"] or unsub["http"]),
        })
    return rows


# ------------------------------------------------------------------ بحث
def _ascii(s: str) -> bool:
    try:
        s.encode("ascii")
        return True
    except UnicodeEncodeError:
        return False


def _astr(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _tokens(q: str) -> List[str]:
    q = _clean_line(q, "البحث", 200)
    toks = []
    for m in re.finditer(r'"([^"]+)"|(\S+)', q):
        t = (m.group(1) or m.group(2) or "").strip()
        if t:
            toks.append(t)
    return toks[:6]


def _uid_search(c: imaplib.IMAP4, criteria: List[str], literal: Optional[str] = None) -> set:
    args = list(criteria)
    if literal is not None:
        c.literal = literal.encode("utf-8")
        typ, data = c.uid("SEARCH", "CHARSET", "UTF-8", *args)
    else:
        typ, data = c.uid("SEARCH", None, *args)
    if typ != "OK":
        return set()
    raw = data[0] if data else b""
    return {int(x) for x in (raw.split() if raw else [])}


def _search_term(c: imaplib.IMAP4, term: str, base: List[str]) -> set:
    fields = ("FROM", "TO", "CC", "SUBJECT", "TEXT")
    if _ascii(term):
        t = _astr(term)
        expr = ["OR", "OR", "FROM", t, "TO", t, "OR", "OR", "CC", t, "SUBJECT", t, "TEXT", t]
        return _uid_search(c, base + expr) if base else _uid_search(c, expr)
    found: set = set()
    for f in fields:
        try:
            found |= _uid_search(c, base + [f], term)
        except Exception:
            continue
    return found


def _date_crit(since: str, before: str) -> List[str]:
    out = []
    for key, val in (("SINCE", since), ("BEFORE", before)):
        m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", val or "")
        if m:
            d = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            out += [key, d.strftime("%d-%b-%Y")]
    return out


def list_messages(a: Acct, p: dict) -> dict:
    folder = _clean_line(p.get("folder") or "INBOX", "المجلد", 300)
    size = max(1, min(MAX_LIST, int(p.get("size") or 30)))
    page = max(0, int(p.get("page") or 0))
    flt = str(p.get("filter") or "all")
    after = int(p.get("after_uid") or 0)
    toks = _tokens(p.get("q") or "")
    base: List[str] = []
    if flt == "unread":
        base += ["UNSEEN"]
    elif flt == "flagged":
        base += ["FLAGGED"]
    base += _date_crit(str(p.get("since") or ""), str(p.get("before") or ""))
    with imap(a) as s:
        _select(s, folder, True)
        c = s.conn
        uids = _uid_search(c, base or ["ALL"])
        for t in toks:
            uids &= _search_term(c, t, [])
        if after:
            uids = {u for u in uids if u > after}
        ordered = sorted(uids, reverse=True)
        total = len(ordered)
        chunk = ordered[page * size:(page + 1) * size]
        rows: List[dict] = []
        if chunk:
            typ, data = c.uid("FETCH", ",".join(map(str, chunk)),
                              "(UID FLAGS BODYSTRUCTURE BODY.PEEK[HEADER.FIELDS (%s)])" % _HDR_FIELDS)
            if typ != "OK":
                raise _err("تعذّر جلب الرسائل.", 502, "protocol")
            rows = _parse_fetch(data)
            rows.sort(key=lambda r: r["uid"], reverse=True)
        return {"rows": rows, "total": total, "page": page, "more": (page + 1) * size < total}


# ------------------------------------------------------------------ قراءة رسالة
def _text_of(part) -> str:
    try:
        return part.get_content()
    except Exception:
        try:
            raw = part.get_payload(decode=True) or b""
            return raw.decode(part.get_content_charset() or "utf-8", "replace")
        except Exception:
            return ""


def parse_message(raw: bytes, inline: bool = True) -> dict:
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    text, html = "", ""
    atts, cids = [], {}
    budget = MAX_INLINE_TOTAL
    idx = 0                                   # ترقيم كل الأجزاء غير المتعددة (يطابق fetch_attachment)
    for part in msg.walk():
        if part.is_multipart():
            continue
        ctype = part.get_content_type()
        disp = (part.get_content_disposition() or "").lower()
        fname = dh(part.get_filename() or "")
        cid = (part.get("Content-ID") or "").strip().strip("<>")
        is_text_body = ctype in ("text/plain", "text/html") and disp != "attachment" and not fname
        if is_text_body:
            if ctype == "text/plain" and not text:
                text = _text_of(part)
            elif ctype == "text/html" and not html:
                html = _text_of(part)
        else:
            data = part.get_payload(decode=True) or b""
            if cid and ctype.startswith("image/") and inline and 0 < len(data) <= budget:
                budget -= len(data)
                cids[cid] = "data:%s;base64,%s" % (ctype, base64.b64encode(data).decode("ascii"))
            elif ctype != "message/rfc822" or fname:
                atts.append({"index": idx, "name": fname or ("attachment-%d" % (len(atts) + 1)), "type": ctype, "size": len(data)})
        idx += 1
    unsub = parse_unsub(msg.get("List-Unsubscribe", ""), msg.get("List-Unsubscribe-Post", ""))
    return {
        "subject": dh(msg.get("Subject")),
        "from": (addr_list(msg.get("From")) or [{"name": "", "addr": ""}])[0],
        "to": addr_list(msg.get("To")),
        "cc": addr_list(msg.get("Cc")),
        "reply_to": addr_list(msg.get("Reply-To")),
        "date": iso_date(msg.get("Date")),
        "msgid": str(msg.get("Message-ID") or "").strip(),
        "references": str(msg.get("References") or "").strip(),
        "text": text[:MAX_BODY_CHARS],
        "html": html[:MAX_BODY_CHARS],
        "cids": cids,
        "attachments": atts,
        "unsub": unsub,
        "auto": is_automated({k.lower(): str(v) for k, v in msg.items()}),
    }


def _fetch_raw(c: imaplib.IMAP4, uid: int) -> bytes:
    typ, data = c.uid("FETCH", str(uid), "(BODY.PEEK[])")
    if typ != "OK":
        raise _err("تعذّر جلب الرسالة.", 502, "protocol")
    for item in data or []:
        if isinstance(item, tuple) and len(item) > 1 and item[1]:
            return item[1]
    raise _err("الرسالة لم تعد موجودة.", 404, "gone")


def read_message(a: Acct, p: dict) -> dict:
    folder = _clean_line(p.get("folder") or "INBOX", "المجلد", 300)
    uid = int(p.get("uid") or 0)
    if uid <= 0:
        raise _err("رقم الرسالة غير صالح.", 400, "bad_input")
    mark = bool(p.get("mark_seen", True))
    with imap(a) as s:
        _select(s, folder, not mark)
        c = s.conn
        raw = _fetch_raw(c, uid)
        out = parse_message(raw, bool(p.get("inline", True)))
        out["uid"] = uid
        out["marked"] = False
        if mark:
            try:
                typ, _ = c.uid("STORE", str(uid), "+FLAGS.SILENT", "(\\Seen)")
                out["marked"] = typ == "OK"
            except Exception:
                out["marked"] = False
        return out


def fetch_attachment(a: Acct, p: dict) -> dict:
    folder = _clean_line(p.get("folder") or "INBOX", "المجلد", 300)
    uid, want = int(p.get("uid") or 0), int(p.get("index"))
    with imap(a) as s:
        _select(s, folder, True)
        msg = email.message_from_bytes(_fetch_raw(s.conn, uid), policy=email.policy.default)
    idx = 0
    for part in msg.walk():
        if part.is_multipart():
            continue
        if idx == want:
            data = part.get_payload(decode=True) or b""
            if len(data) > MAX_ATTACH:
                raise _err("المرفق كبير جدًا (الحد %d ميغابايت)." % (MAX_ATTACH // 1048576), 413, "too_large")
            return {"name": dh(part.get_filename() or "") or "attachment", "type": part.get_content_type(),
                    "b64": base64.b64encode(data).decode("ascii")}
        idx += 1
    raise _err("المرفق غير موجود.", 404, "gone")


# ------------------------------------------------------------------ إرسال
def _join_addrs(v) -> List[str]:
    if isinstance(v, str):
        v = re.split(r"[;,]\s*", v)
    out = []
    for x in v or []:
        x = _clean_line(x, "المستلم", 320)
        if x:
            out.append(x)
    return out


def build_message(a: Acct, p: dict) -> Tuple[EmailMessage, List[str]]:
    to, cc, bcc = _join_addrs(p.get("to")), _join_addrs(p.get("cc")), _join_addrs(p.get("bcc"))
    msg = EmailMessage()
    if a.display:
        msg["From"] = email.utils.formataddr((a.display, a.from_addr))
    else:
        msg["From"] = a.from_addr
    if to:
        msg["To"] = ", ".join(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg["Subject"] = _clean_line(p.get("subject"), "الموضوع", 900)
    msg["Date"] = email.utils.formatdate(localtime=True)
    domain = a.from_addr.split("@")[-1] or "localhost"
    msg["Message-ID"] = email.utils.make_msgid(domain=domain)
    irt = _clean_line(p.get("in_reply_to"), "In-Reply-To", 998)
    if irt:
        msg["In-Reply-To"] = irt
        refs = _clean_line(p.get("references"), "References", 1800)
        msg["References"] = (refs + " " + irt).strip() if refs else irt
    if p.get("auto_reply"):
        msg["Auto-Submitted"] = "auto-replied"
        msg["X-Auto-Response-Suppress"] = "All"
        msg["Precedence"] = "bulk"
    body = str(p.get("text") or "")
    html = str(p.get("html") or "")
    msg.set_content(body or " ")
    if html:
        msg.add_alternative(html, subtype="html")
    total = 0
    for at in p.get("attachments") or []:
        try:
            data = base64.b64decode(at.get("b64") or "", validate=False)
        except Exception:
            continue
        total += len(data)
        if total > MAX_ATTACH:
            raise _err("مجموع المرفقات كبير جدًا (الحد %d ميغابايت)." % (MAX_ATTACH // 1048576), 413, "too_large")
        ctype = str(at.get("type") or "application/octet-stream")
        mt, _, st = ctype.partition("/")
        msg.add_attachment(data, maintype=mt or "application", subtype=st or "octet-stream",
                           filename=_clean_line(at.get("name") or "file", "اسم المرفق", 200))
    return msg, to + cc + bcc


def _smtp_send(a: Acct, msg: EmailMessage, rcpts: List[str]) -> None:
    if not a.smtp_host:
        raise _err("خادم SMTP غير مضبوط.", 400, "bad_input")
    if not rcpts:
        raise _err("أضف مستلمًا واحدًا على الأقل.", 400, "no_rcpt")
    try:
        if a.smtp_sec == "ssl":
            srv = smtplib.SMTP_SSL(a.smtp_host, a.smtp_port, timeout=TIMEOUT, context=ssl_context())
        else:
            srv = smtplib.SMTP(a.smtp_host, a.smtp_port, timeout=TIMEOUT)
        try:
            srv.ehlo()
            if a.smtp_sec == "starttls":
                srv.starttls(context=ssl_context())
                srv.ehlo()
            srv.login(a.user, a.password)
            srv.send_message(msg, from_addr=email.utils.parseaddr(a.from_addr)[1] or a.from_addr, to_addrs=rcpts)
        finally:
            try:
                srv.quit()
            except Exception:
                pass
    except Exception as e:
        raise _net_error(e, "خادم SMTP")


def _append(a: Acct, role: str, msg: EmailMessage, flags: str) -> bool:
    try:
        folder = role_folder(a, role)
        if not folder:
            return False
        with imap(a) as s:
            typ, _ = s.conn.append(_q(folder), flags, imaplib.Time2Internaldate(time.time()), msg.as_bytes())
            return typ == "OK"
    except GatewayError:
        return False


def send_message(a: Acct, p: dict) -> dict:
    msg, rcpts = build_message(a, p)
    _smtp_send(a, msg, rcpts)
    saved = _append(a, "sent", msg, "(\\Seen)") if p.get("save_sent", True) else False
    answered = False
    ru, rf = int(p.get("reply_uid") or 0), p.get("reply_folder")
    if ru and rf:
        try:
            with imap(a) as s:
                _select(s, str(rf), False)
                typ, _ = s.conn.uid("STORE", str(ru), "+FLAGS.SILENT", "(\\Answered)")
                answered = typ == "OK"
        except GatewayError:
            pass
    return {"sent": True, "saved": saved, "answered": answered, "msgid": str(msg["Message-ID"])}


def save_draft(a: Acct, p: dict) -> dict:
    msg, _ = build_message(a, p)
    ok = _append(a, "drafts", msg, "(\\Draft \\Seen)")
    if not ok:
        raise _err("تعذّر حفظ المسودة: لم يُعثر على مجلد المسودات.", 404, "no_folder")
    return {"saved": True}


# ------------------------------------------------------------------ علامات ونقل وحذف
def _uids(p: dict) -> List[int]:
    raw = p.get("uids")
    if raw is None and p.get("uid") is not None:
        raw = [p.get("uid")]
    out = []
    for u in raw or []:
        try:
            u = int(u)
        except (TypeError, ValueError):
            continue
        if u > 0 and u not in out:
            out.append(u)
    if not out:
        raise _err("لم تُحدَّد رسائل.", 400, "bad_input")
    return out[:500]


def _store(c: imaplib.IMAP4, uids: List[int], op: str, flag: str) -> None:
    typ, _ = c.uid("STORE", ",".join(map(str, uids)), op, "(%s)" % flag)
    if typ != "OK":
        raise _err("فشل تعديل حالة الرسائل.", 502, "protocol")


def _caps(c: imaplib.IMAP4) -> set:
    try:
        return {x.upper() for x in c.capabilities}
    except Exception:
        return set()


def _existing(c: imaplib.IMAP4, uids: List[int]) -> List[int]:
    """يبقي فقط الـ UID الموجودة فعلًا؛ لا نفسّر UID مفقودًا كرقم تسلسل أبدًا."""
    typ, data = c.uid("FETCH", ",".join(map(str, uids)), "(UID)")
    have = set()
    for item in data or []:
        raw = item[0] if isinstance(item, tuple) else item
        if isinstance(raw, bytes):
            m = re.search(rb"UID (\d+)", raw)
            if m:
                have.add(int(m.group(1)))
    return [u for u in uids if u in have]


def _remove(c: imaplib.IMAP4, uids: List[int]) -> bool:
    """يحذف الرسائل من المجلد المحدد حاليًا بأمان (UID EXPUNGE فقط)."""
    _store(c, uids, "+FLAGS.SILENT", "\\Deleted")
    if "UIDPLUS" in _caps(c):
        typ, _ = c.uid("EXPUNGE", ",".join(map(str, uids)))
        return typ == "OK"
    return False  # لا نستخدم EXPUNGE العام كي لا نمسّ رسائل غير مقصودة


def mark_messages(a: Acct, p: dict) -> dict:
    folder = _clean_line(p.get("folder") or "INBOX", "المجلد", 300)
    op = str(p.get("op") or "")
    uids = _uids(p)
    spec = {"read": ("+FLAGS.SILENT", "\\Seen"), "unread": ("-FLAGS.SILENT", "\\Seen"),
            "flag": ("+FLAGS.SILENT", "\\Flagged"), "unflag": ("-FLAGS.SILENT", "\\Flagged"),
            "answered": ("+FLAGS.SILENT", "\\Answered"), "unanswered": ("-FLAGS.SILENT", "\\Answered")}
    if op in ("spam", "notspam"):
        return move_messages(a, {"folder": folder, "uids": uids,
                                 "dest_role": "junk" if op == "spam" else "inbox"})
    if op not in spec:
        raise _err("عملية غير معروفة.", 400, "bad_input")
    with imap(a) as s:
        _select(s, folder, False)
        uids = _existing(s.conn, uids)
        if uids:
            _store(s.conn, uids, *spec[op])
    return {"done": len(uids)}


def move_messages(a: Acct, p: dict) -> dict:
    folder = _clean_line(p.get("folder") or "INBOX", "المجلد", 300)
    dest = p.get("dest")
    if not dest and p.get("dest_role"):
        dest = role_folder(a, str(p["dest_role"]))
        if not dest:
            raise _err("لم يُعثر على المجلد الهدف (%s)." % p["dest_role"], 404, "no_folder")
    dest = _clean_line(dest, "المجلد الهدف", 300)
    if dest == folder:
        return {"done": 0}
    uids = _uids(p)
    with imap(a) as s:
        _select(s, folder, False)
        c = s.conn
        uids = _existing(c, uids)
        if not uids:
            return {"done": 0}
        ids = ",".join(map(str, uids))
        if "MOVE" in _caps(c):
            typ, _ = c.uid("MOVE", ids, _q(dest))
            if typ != "OK":
                raise _err("فشل نقل الرسائل.", 502, "protocol")
        else:
            typ, _ = c.uid("COPY", ids, _q(dest))
            if typ != "OK":
                raise _err("فشل نسخ الرسائل إلى المجلد الهدف.", 502, "protocol")
            if not _remove(c, uids):
                return {"done": len(uids), "warn": "نُسخت الرسائل، لكن الخادم لا يدعم الحذف الآمن فبقيت نسخ مشطوبة في المجلد الأصلي."}
        return {"done": len(uids)}


def delete_messages(a: Acct, p: dict) -> dict:
    folder = _clean_line(p.get("folder") or "INBOX", "المجلد", 300)
    uids = _uids(p)
    perm = bool(p.get("permanent"))
    trash = None if perm else role_folder(a, "trash")
    role_here = next((r["role"] for r in list_folders(a) if r["name"] == folder), "")
    if perm or not trash or role_here in ("trash", "junk") or trash == folder:
        with imap(a) as s:
            _select(s, folder, False)
            uids = _existing(s.conn, uids)
            if not uids:
                return {"done": 0}
            ok = _remove(s.conn, uids)
            return {"done": len(uids), "permanent": True,
                    **({} if ok else {"warn": "الخادم لا يدعم الحذف الآمن؛ شُطبت الرسائل دون إزالتها."})}
    return move_messages(a, {"folder": folder, "uids": uids, "dest": trash})


def archive_messages(a: Acct, p: dict) -> dict:
    dest = role_folder(a, "archive") or role_folder(a, "all")
    if not dest:
        raise _err("لا يوجد مجلد أرشيف في هذا الحساب.", 404, "no_folder")
    return move_messages(a, {"folder": p.get("folder") or "INBOX", "uids": _uids(p), "dest": dest})


# ------------------------------------------------------------------ النشرات وإلغاء الاشتراك
def unsub_scan(a: Acct, p: dict) -> dict:
    folder = _clean_line(p.get("folder") or "INBOX", "المجلد", 300)
    limit = max(20, min(600, int(p.get("limit") or 300)))
    with imap(a) as s:
        _select(s, folder, True)
        c = s.conn
        uids = sorted(_uid_search(c, ["ALL"]), reverse=True)[:limit]
        groups: Dict[str, dict] = {}
        for i in range(0, len(uids), 100):
            part = uids[i:i + 100]
            typ, data = c.uid("FETCH", ",".join(map(str, part)), "(UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE LIST-UNSUBSCRIBE LIST-UNSUBSCRIBE-POST)])")
            if typ != "OK":
                continue
            for meta, hdr in _fetch_items(data):
                um = re.search(r"UID (\d+)", meta)
                if not um:
                    continue
                h = _raw_headers(hdr)
                u = parse_unsub(h.get("list-unsubscribe", ""), h.get("list-unsubscribe-post", ""))
                if not (u["mailto"] or u["http"]):
                    continue
                frm = (addr_list(h.get("from")) or [{"name": "", "addr": ""}])[0]
                key = (frm["addr"] or "?").lower()
                g = groups.setdefault(key, {"sender": frm["addr"], "name": frm["name"], "count": 0, "uids": [],
                                           "subject": dh(h.get("subject")), "date": iso_date(h.get("date")),
                                           "mailto": u["mailto"], "http": u["http"], "oneclick": u["oneclick"]})
                g["count"] += 1
                g["uids"].append(int(um.group(1)))
                if u["oneclick"] and not g["oneclick"]:
                    g.update(http=u["http"], oneclick=True)
        items = sorted(groups.values(), key=lambda g: -g["count"])
        return {"items": items, "scanned": len(uids)}


def _guard_url(url: str) -> urllib.parse.ParseResult:
    from . import web
    return web.check_url(url)


def unsub_exec(a: Acct, p: dict) -> dict:
    """ينفّذ إلغاء اشتراك واحد: نقرة واحدة (POST) ثم رسالة mailto، وإلا يعيد الرابط ليفتحه المستخدم."""
    from . import web
    http_u = str(p.get("http") or "").strip()
    mailto = str(p.get("mailto") or "").strip()
    if http_u and p.get("oneclick"):
        _guard_url(http_u)
        try:
            resp = web._open(http_u, data=b"List-Unsubscribe=One-Click", method="POST",
                             headers={"Content-Type": "application/x-www-form-urlencoded"})
            code = getattr(resp, "status", 200)
            resp.close()
            if 200 <= int(code) < 400:
                return {"method": "oneclick", "ok": True}
        except GatewayError:
            pass
    if mailto:
        u = urllib.parse.urlparse(mailto)
        to = urllib.parse.unquote(u.path)
        q = urllib.parse.parse_qs(u.query)
        subj = (q.get("subject") or ["unsubscribe"])[0]
        body = (q.get("body") or [""])[0]
        msg = {"to": [to], "subject": subj, "text": body or "unsubscribe", "save_sent": False}
        built, rc = build_message(a, msg)
        _smtp_send(a, built, rc)
        return {"method": "mailto", "ok": True}
    if http_u:
        _guard_url(http_u)
        return {"method": "open", "ok": False, "url": http_u}
    raise _err("لا توجد وسيلة إلغاء اشتراك لهذه الرسالة.", 404, "no_unsub")


# ------------------------------------------------------------------ عيّنات المرسل (لاستخراج أسلوب الكتابة)
_QUOTE = re.compile(r"^(>|On .+wrote:|في .+كتب|-----Original Message-----|From:\s)", re.I)


def strip_quoted(text: str) -> str:
    out = []
    for line in (text or "").splitlines():
        if _QUOTE.match(line.strip()):
            break
        out.append(line)
    return "\n".join(out).strip()


def sent_samples(a: Acct, p: dict) -> dict:
    n = max(3, min(25, int(p.get("n") or 12)))
    folder = role_folder(a, "sent")
    if not folder:
        raise _err("لم يُعثر على مجلد المرسل.", 404, "no_folder")
    samples = []
    with imap(a) as s:
        _select(s, folder, True)
        uids = sorted(_uid_search(s.conn, ["ALL"]), reverse=True)[:n * 2]
        for u in uids:
            if len(samples) >= n:
                break
            try:
                m = parse_message(_fetch_raw(s.conn, u), inline=False)
            except GatewayError:
                continue
            t = strip_quoted(m["text"])
            if len(t) >= 40:
                samples.append(t[:1500])
    return {"samples": samples}


# ------------------------------------------------------------------ اختبار الحساب
def test_account(a: Acct, p: dict) -> dict:
    res = {"imap": False, "smtp": None, "folders": 0}
    c = _imap_connect(a)
    try:
        typ, data = c.list()
        res["imap"] = True
        res["folders"] = len(data or []) if typ == "OK" else 0
    finally:
        try:
            c.logout()
        except Exception:
            pass
    if a.smtp_host and p.get("smtp", True):
        try:
            if a.smtp_sec == "ssl":
                srv = smtplib.SMTP_SSL(a.smtp_host, a.smtp_port, timeout=TIMEOUT, context=ssl_context())
            else:
                srv = smtplib.SMTP(a.smtp_host, a.smtp_port, timeout=TIMEOUT)
            try:
                srv.ehlo()
                if a.smtp_sec == "starttls":
                    srv.starttls(context=ssl_context())
                    srv.ehlo()
                srv.login(a.user, a.password)
                res["smtp"] = True
            finally:
                try:
                    srv.quit()
                except Exception:
                    pass
        except Exception as e:
            ge = _net_error(e, "خادم SMTP")
            res["smtp"] = False
            res["smtp_error"] = ge.message
    return res


# ------------------------------------------------------------------ نقطة الدخول
def run(op: str, body: dict) -> dict:
    a = Acct(body.get("acct"))
    if op == "test":
        return {"ok": True, **test_account(a, body)}
    if op == "folders":
        return {"ok": True, "folders": folders_with_counts(a)}
    if op == "status":
        return {"ok": True, **folder_status(a, _clean_line(body.get("folder") or "INBOX", "المجلد", 300))}
    if op == "list":
        return {"ok": True, **list_messages(a, body)}
    if op == "read":
        return {"ok": True, **read_message(a, body)}
    if op == "attachment":
        return {"ok": True, **fetch_attachment(a, body)}
    if op == "send":
        return {"ok": True, **send_message(a, body)}
    if op == "draft":
        return {"ok": True, **save_draft(a, body)}
    if op == "mark":
        return {"ok": True, **mark_messages(a, body)}
    if op == "move":
        return {"ok": True, **move_messages(a, body)}
    if op == "delete":
        return {"ok": True, **delete_messages(a, body)}
    if op == "archive":
        return {"ok": True, **archive_messages(a, body)}
    if op == "unsub_scan":
        return {"ok": True, **unsub_scan(a, body)}
    if op == "unsub_exec":
        return {"ok": True, **unsub_exec(a, body)}
    if op == "sent_samples":
        return {"ok": True, **sent_samples(a, body)}
    raise _err("عملية بريد غير معروفة.", 404, "not_found")


OPS = ("test", "folders", "status", "list", "read", "attachment", "send", "draft", "mark", "move",
       "delete", "archive", "unsub_scan", "unsub_exec", "sent_samples")
