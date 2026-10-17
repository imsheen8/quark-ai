"""
التخزين الدائم في بايثون — بديل localStorage وIndexedDB في المتصفح.

كل بيانات التطبيق تُحفظ على الجهاز الذي يشغّل بايثون (الحاسوب أو داخل الـ APK)، في مجلد واحد:

    <data>/quark.db        قاعدة SQLite (وضع WAL)
    <data>/files/xx/<id>   الصور والملفات الثنائية (ملف لكل عنصر)

الجداول:
    kv     كل الحالة الصغيرة (الإعدادات، الذاكرة، المهام، البريد، المكتبة …) — قيمة JSON لكل مفتاح
    chats  محادثة لكل صف (حتى لا يُعاد كتابة كل المحادثات عند كل رسالة) + ترتيبها
    files  بيانات وصفية للملفات (النوع والحجم)
    meta   علامات داخلية (مثل: تم نقل بيانات المتصفح القديمة)

المجلد: متغير البيئة QUARK_DATA_DIR، وإلا مجلد data بجانب serve.py.
مكتبة بايثون القياسية فقط (sqlite3).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import tempfile
import threading
import time
from typing import Dict, Iterable, List, Optional, Tuple

from .errors import GatewayError

SCHEMA_VERSION = 1
CHATS_KEY = "ai_chats"
MAX_VALUE = 40 * 1024 * 1024
MAX_FILE = 48 * 1024 * 1024

_KEY_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
_MIME_RE = re.compile(r"^[a-z0-9][a-z0-9.+-]{0,60}/[a-z0-9][a-z0-9.+-]{0,100}$")

_lock = threading.RLock()
_dir: Optional[str] = None
_ready_for: Optional[str] = None


def _bad(msg: str, status: int = 400, code: str = "bad_request") -> GatewayError:
    return GatewayError(msg, status, code)


# ---------------------------------------------------------------- المجلد والاتصال
def default_dir() -> str:
    env = os.environ.get("QUARK_DATA_DIR", "").strip()
    if env:
        return os.path.abspath(os.path.expanduser(env))
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(root, "data")


def configure(path: Optional[str] = None) -> str:
    """يحدّد مجلد البيانات (يُستدعى مرة عند بدء الخادم). يعيد المسار المستخدم."""
    global _dir, _ready_for
    with _lock:
        _dir = os.path.abspath(os.path.expanduser(path)) if path else default_dir()
        _ready_for = None
        _ensure()
        return _dir


def data_dir() -> str:
    return _dir or default_dir()


def _chmod(path: str, mode: int) -> None:
    try:
        os.chmod(path, mode)
    except OSError:
        pass                                       # ويندوز / أنظمة ملفات لا تدعمه


def _db_path() -> str:
    return os.path.join(data_dir(), "quark.db")


def _files_dir() -> str:
    return os.path.join(data_dir(), "files")


def _ensure() -> None:
    """ينشئ المجلد والجداول مرة واحدة لكل مجلد."""
    global _ready_for
    d = data_dir()
    if _ready_for == d:
        return
    with _lock:
        if _ready_for == d:
            return
        os.makedirs(os.path.join(d, "files"), exist_ok=True)
        _chmod(d, 0o700)
        c = sqlite3.connect(_db_path(), timeout=30)
        try:
            c.execute("PRAGMA journal_mode=WAL")
            c.executescript(
                """
                CREATE TABLE IF NOT EXISTS kv(
                    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS chats(
                    id TEXT PRIMARY KEY, pos INTEGER NOT NULL, data TEXT NOT NULL, updated REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS chats_pos ON chats(pos);
                CREATE TABLE IF NOT EXISTS files(
                    id TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                """
            )
            c.execute("INSERT OR IGNORE INTO meta(key, value) VALUES('schema', ?)", (str(SCHEMA_VERSION),))
            c.commit()
        finally:
            c.close()
        for p in (_db_path(), _db_path() + "-wal", _db_path() + "-shm"):
            if os.path.exists(p):
                _chmod(p, 0o600)
        _ready_for = d


class _Conn:
    """اتصال قصير العمر لكل طلب (آمن مع الخيوط). يلتزم عند النجاح ويتراجع عند الفشل."""

    def __enter__(self) -> sqlite3.Connection:
        _ensure()
        self.c = sqlite3.connect(_db_path(), timeout=30)
        self.c.execute("PRAGMA synchronous=NORMAL")
        return self.c

    def __exit__(self, et, ev, tb) -> None:
        try:
            if et is None:
                self.c.commit()
            else:
                self.c.rollback()
        finally:
            self.c.close()


# ---------------------------------------------------------------- اللقطة الكاملة (عند فتح التطبيق)
def snapshot_json() -> bytes:
    """
    كل الحالة بصيغة JSON جاهزة:
      { ok, migrated, items:{مفتاح: نص JSON}, chats:[كائنات المحادثات بالترتيب] }
    المحادثات تُلصق كما هي (دون ترميز مزدوج) لتبقى اللقطة صغيرة وسريعة.
    """
    with _Conn() as c:
        items = {k: v for k, v in c.execute("SELECT key, value FROM kv")}
        rows = [r[0] for r in c.execute("SELECT data FROM chats ORDER BY pos ASC")]
        mig = c.execute("SELECT value FROM meta WHERE key='migrated'").fetchone()
    head = '{"ok":true,"migrated":%s,"items":%s,"chats":[' % (
        "true" if mig and mig[0] == "1" else "false",
        json.dumps(items, ensure_ascii=False),
    )
    return (head + ",".join(rows) + "]}").encode("utf-8")


# ---------------------------------------------------------------- المفاتيح العامة (kv)
def set_items(items: Dict[str, Optional[str]]) -> int:
    """يكتب/يحذف عدة مفاتيح في معاملة واحدة. القيمة None = حذف. يعيد عدد المفاتيح."""
    if not isinstance(items, dict):
        raise _bad("items غير صالحة.")
    now = time.time()
    puts: List[Tuple[str, str, float]] = []
    dels: List[Tuple[str]] = []
    for k, v in items.items():
        if not isinstance(k, str) or not _KEY_RE.match(k):
            raise _bad("مفتاح غير صالح: %s" % str(k)[:40])
        if k == CHATS_KEY:
            raise _bad("المحادثات تُحفظ عبر store/chats.")
        if v is None:
            dels.append((k,))
        elif isinstance(v, str):
            if len(v) > MAX_VALUE:
                raise _bad("القيمة كبيرة جدًا للمفتاح %s." % k, 413, "too_large")
            puts.append((k, v, now))
        else:
            raise _bad("قيمة المفتاح %s يجب أن تكون نصًا." % k)
    with _Conn() as c:
        c.executemany(
            "INSERT INTO kv(key, value, updated) VALUES(?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated=excluded.updated",
            puts,
        )
        c.executemany("DELETE FROM kv WHERE key=?", dels)
    return len(puts) + len(dels)


def get_items(keys: Iterable[str]) -> Dict[str, str]:
    """يقرأ عدة مفاتيح من kv مباشرة (للمجدول داخل الخادم). المفاتيح غير الموجودة تُهمل."""
    ks = [k for k in keys if isinstance(k, str) and _KEY_RE.match(k)]
    if not ks:
        return {}
    with _Conn() as c:
        q = "SELECT key, value FROM kv WHERE key IN (%s)" % ",".join("?" * len(ks))
        return {k: v for k, v in c.execute(q, ks)}


# ---------------------------------------------------------------- المحادثات
def sync_chats(upsert: Iterable[dict], delete: Iterable[str], order: Optional[List[str]]) -> Dict[str, int]:
    """
    مزامنة تفاضلية: يُرسل المتصفح فقط المحادثات التي تغيّرت + المحذوفة + الترتيب الكامل (معرّفات).
    """
    ups: List[Tuple[str, str]] = []
    for ch in upsert or []:
        cid = ch.get("id") if isinstance(ch, dict) else None
        if not isinstance(cid, str) or not cid or len(cid) > 200:
            raise _bad("محادثة بلا معرّف صالح.")
        ups.append((cid, json.dumps(ch, ensure_ascii=False, separators=(",", ":"))))
    dels = [(d,) for d in (delete or []) if isinstance(d, str)]
    ords = [str(x) for x in (order or []) if isinstance(x, str)]
    now = time.time()
    with _Conn() as c:
        # الموضع الحالي للمحادثات الجديدة: نهاية القائمة، ثم يصحّحه order
        base = c.execute("SELECT COALESCE(MAX(pos), -1) + 1 FROM chats").fetchone()[0]
        for i, (cid, data) in enumerate(ups):
            c.execute(
                "INSERT INTO chats(id, pos, data, updated) VALUES(?,?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated=excluded.updated",
                (cid, base + i, data, now),
            )
        c.executemany("DELETE FROM chats WHERE id=?", dels)
        if ords:
            c.executemany("UPDATE chats SET pos=? WHERE id=?", [(i, cid) for i, cid in enumerate(ords)])
        n = c.execute("SELECT COUNT(*) FROM chats").fetchone()[0]
    return {"upserted": len(ups), "deleted": len(dels), "total": n}


# ---------------------------------------------------------------- علامات داخلية
def set_migrated() -> None:
    with _Conn() as c:
        c.execute("INSERT INTO meta(key, value) VALUES('migrated','1') ON CONFLICT(key) DO UPDATE SET value='1'")


# ---------------------------------------------------------------- الملفات (الصور والمرفقات)
def _file_path(fid: str) -> str:
    if not _ID_RE.match(fid or ""):
        raise _bad("معرّف ملف غير صالح.")
    return os.path.join(_files_dir(), fid[:2], fid)


def put_file(fid: str, mime: str, data: bytes) -> int:
    path = _file_path(fid)
    mime = (mime or "").split(";")[0].strip().lower() or "application/octet-stream"
    if not _MIME_RE.match(mime):
        mime = "application/octet-stream"
    if len(data) > MAX_FILE:
        raise _bad("الملف كبير جدًا.", 413, "too_large")
    _ensure()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".up-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        _chmod(tmp, 0o600)
        os.replace(tmp, path)                      # كتابة ذرّية: لا ملف نصف مكتوب
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    with _Conn() as c:
        c.execute(
            "INSERT INTO files(id, mime, size, created) VALUES(?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET mime=excluded.mime, size=excluded.size",
            (fid, mime, len(data), time.time()),
        )
    return len(data)


def get_file(fid: str) -> Optional[Tuple[str, bytes]]:
    path = _file_path(fid)
    with _Conn() as c:
        row = c.execute("SELECT mime FROM files WHERE id=?", (fid,)).fetchone()
    if not row:
        return None
    try:
        with open(path, "rb") as f:
            return row[0], f.read()
    except FileNotFoundError:
        return None


def delete_file(fid: str) -> bool:
    path = _file_path(fid)
    with _Conn() as c:
        cur = c.execute("DELETE FROM files WHERE id=?", (fid,))
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    return cur.rowcount > 0


def list_files() -> List[dict]:
    with _Conn() as c:
        return [{"id": i, "mime": m, "size": s} for i, m, s in c.execute("SELECT id, mime, size FROM files")]


# ---------------------------------------------------------------- إحصاءات ومسح
def stats() -> dict:
    with _Conn() as c:
        chats_n, chats_b = c.execute("SELECT COUNT(*), COALESCE(SUM(LENGTH(CAST(data AS BLOB))),0) FROM chats").fetchone()
        kv_n, kv_b = c.execute("SELECT COUNT(*), COALESCE(SUM(LENGTH(CAST(value AS BLOB))),0) FROM kv").fetchone()
        files_n, files_b = c.execute("SELECT COUNT(*), COALESCE(SUM(size),0) FROM files").fetchone()
    try:
        free = shutil.disk_usage(data_dir()).free
    except OSError:
        free = 0
    return {
        "chats": chats_b, "chats_n": chats_n,
        "kv": kv_b, "kv_n": kv_n,
        "files": files_b, "files_n": files_n,
        "disk_free": free, "dir": data_dir(),
    }


def wipe() -> None:
    """يمسح كل شيء (نسيان رمز الأمان). يعلّم النقل منتهيًا كي لا تُستعاد نسخ المتصفح القديمة."""
    with _Conn() as c:
        c.execute("DELETE FROM kv")
        c.execute("DELETE FROM chats")
        c.execute("DELETE FROM files")
        c.execute("INSERT INTO meta(key, value) VALUES('migrated','1') ON CONFLICT(key) DO UPDATE SET value='1'")
    shutil.rmtree(_files_dir(), ignore_errors=True)
    os.makedirs(_files_dir(), exist_ok=True)
