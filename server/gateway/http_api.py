"""
واجهة HTTP للبوابة: التوجيه والحماية والبث (SSE).

المسارات (كلها تحت /api/gw/):
  GET  health   فحص الجاهزية
  POST models   جلب نماذج نقطة اتصال
  POST chat     محادثة متدفقة (text/event-stream)
  POST once     طلب واحد غير متدفق (عنوان، اختبار)
  POST image    توليد صورة
  POST search   بحث ويب (البحث العميق)
  POST fetch    جلب صفحة واستخراج نصها (البحث العميق)
  POST int/<op>   التكاملات: call (استدعاء API) · webhook (حدث موقَّع)
  POST mail/<op>  البريد: test folders status list read attachment send draft mark move delete archive unsub_scan unsub_exec sent_samples

التخزين الدائم (storage.py) — كل بيانات التطبيق تُحفظ هنا بدل المتصفح:
  GET  store/snapshot   كل الحالة عند فتح التطبيق (المفاتيح + المحادثات)
  POST store/set        {items:{مفتاح: نص | null}}  كتابة/حذف مفاتيح
  POST store/chats      {upsert:[محادثات], delete:[معرّفات], order:[معرّفات]}  مزامنة تفاضلية
  POST store/migrated   علامة: انتهى نقل بيانات المتصفح القديمة
  GET  store/stats      أحجام وعدد وما تبقّى من القرص
  POST store/wipe       مسح كل شيء (نسيان رمز الأمان)
  GET  files            قائمة الملفات (معرّف/نوع/حجم)
  GET  files/<id>       محتوى ملف
  POST files/<id>       رفع ملف (جسم خام، النوع من Content-Type)
  POST files/<id>/delete  حذف ملف

الحماية:
  - الطلبات من الجهاز نفسه وبنفس الأصل (origin) مسموحة مباشرة.
  - أي طلب من شبكة أخرى أو من موقع آخر يتطلب رمزًا: متغير البيئة QUARK_GW_TOKEN
    يُرسل في ترويسة X-Quark-Token.
  - QUARK_GW_LAN=1 يسمح لأجهزة الشبكة المحلية الخاصة بدون رمز.
"""
from __future__ import annotations

import hmac
import ipaddress
import json
import os
import queue
import threading
from typing import Optional, Tuple
from urllib.parse import urlparse

from . import __version__, integrations, mail, service, storage, tasks, web
from .errors import GatewayError
from .transport import Cancel

PREFIX = "/api/gw/"
MAX_BODY = 48 * 1024 * 1024
_PING_EVERY = 10.0


def _truthy(v: str) -> bool:
    return (v or "").strip().lower() in ("1", "true", "yes", "on")


def _token() -> str:
    return os.environ.get("QUARK_GW_TOKEN", "").strip()


def _is_loopback(addr: str) -> bool:
    try:
        return ipaddress.ip_address(addr.split("%")[0]).is_loopback or ipaddress.ip_address(addr.split("%")[0]).ipv4_mapped == ipaddress.ip_address("127.0.0.1")
    except (ValueError, AttributeError):
        return addr.startswith("127.") or addr == "::1"


def _is_private(addr: str) -> bool:
    try:
        ip = ipaddress.ip_address(addr.split("%")[0])
        return ip.is_private or ip.is_loopback or ip.is_link_local
    except ValueError:
        return False


def check_access(h) -> Optional[Tuple[int, str]]:
    tok = _token()
    given = h.headers.get("X-Quark-Token", "")
    if tok and given and hmac.compare_digest(tok, given):
        return None
    client = h.client_address[0]
    origin = h.headers.get("Origin")
    cross = bool(origin) and urlparse(origin).netloc != h.headers.get("Host", "")
    if cross:
        return 403, "طلب من موقع آخر يتطلب رمز البوابة (QUARK_GW_TOKEN)."
    if _is_loopback(client):
        return None
    if _truthy(os.environ.get("QUARK_GW_LAN", "")) and _is_private(client):
        return None
    return 403, "هذا الجهاز غير مصرّح له باستخدام البوابة. عيّن QUARK_GW_TOKEN في الخادم وأدخله في إعدادات التطبيق."


def _cors(h) -> None:
    origin = h.headers.get("Origin")
    if origin:
        h.send_header("Access-Control-Allow-Origin", origin)
        h.send_header("Vary", "Origin")
        h.send_header("Access-Control-Allow-Headers", "content-type, x-quark-token")
        h.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")


def _json(h, status: int, obj: dict) -> None:
    raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    h.send_response(status)
    h.send_header("Content-Type", "application/json; charset=utf-8")
    h.send_header("Content-Length", str(len(raw)))
    h.send_header("Cache-Control", "no-store")
    _cors(h)
    h.end_headers()
    h.wfile.write(raw)


def _send(h, status: int, body: bytes, ctype: str, extra: Optional[dict] = None) -> None:
    h.send_response(status)
    h.send_header("Content-Type", ctype)
    h.send_header("Content-Length", str(len(body)))
    for k, v in (extra or {}).items():
        h.send_header(k, v)
    _cors(h)
    h.end_headers()
    h.wfile.write(body)


def _read_raw(h, limit: int) -> bytes:
    try:
        n = int(h.headers.get("Content-Length") or 0)
    except ValueError:
        n = 0
    if n < 0 or n > limit:
        raise GatewayError("حجم الملف كبير جدًا (الحد %d ميغابايت)." % (limit // 1024 // 1024), 413, "too_large")
    return h.rfile.read(n) if n else b""


def _store_route(h, method: str, route: str) -> bool:
    """مسارات التخزين. تعيد True إن عالجت الطلب."""
    if method == "GET" and route == "store/snapshot":
        _send(h, 200, storage.snapshot_json(), "application/json; charset=utf-8", {"Cache-Control": "no-store"})
    elif method == "GET" and route == "store/stats":
        _json(h, 200, dict(storage.stats(), ok=True))
    elif method == "POST" and route == "store/set":
        items = _read_body(h).get("items")
        n = storage.set_items(items)
        if isinstance(items, dict) and any(k in items for k in tasks.KEYS + tasks.mailjobs.KEYS):
            tasks.reload()                                   # استيراد/استعادة بيانات تمس المهام
        _json(h, 200, {"ok": True, "n": n})
    elif method == "POST" and route == "store/chats":
        b = _read_body(h)
        _json(h, 200, dict(storage.sync_chats(b.get("upsert"), b.get("delete"), b.get("order")), ok=True))
    elif method == "POST" and route == "store/migrated":
        storage.set_migrated()
        _json(h, 200, {"ok": True})
    elif method == "POST" and route == "store/wipe":
        storage.wipe()
        tasks.reload()
        _json(h, 200, {"ok": True})
    elif method == "GET" and route == "files":
        _json(h, 200, {"ok": True, "files": storage.list_files()})
    elif route.startswith("files/"):
        rest = route[6:]
        if method == "GET" and "/" not in rest:
            got = storage.get_file(rest)
            if not got:
                _json(h, 404, {"ok": False, "error": "الملف غير موجود", "code": "not_found"})
            else:
                _send(h, 200, got[1], got[0], {
                    "Cache-Control": "private, max-age=86400",
                    "X-Content-Type-Options": "nosniff",
                    "Content-Security-Policy": "sandbox",        # ملف مرفوع لا يُنفَّذ كصفحة أبدًا
                })
        elif method == "POST" and rest.endswith("/delete") and "/" not in rest[:-7]:
            _json(h, 200, {"ok": True, "deleted": storage.delete_file(rest[:-7])})
        elif method == "POST" and "/" not in rest:
            size = storage.put_file(rest, h.headers.get("Content-Type", ""), _read_raw(h, storage.MAX_FILE))
            _json(h, 200, {"ok": True, "size": size})
        else:
            return False
    else:
        return False
    return True


def _read_body(h) -> dict:
    try:
        n = int(h.headers.get("Content-Length") or 0)
    except ValueError:
        n = 0
    if n <= 0:
        raise GatewayError("الطلب فارغ.", 400, "bad_request")
    if n > MAX_BODY:
        raise GatewayError("حجم الطلب كبير جدًا (الحد %d ميغابايت)." % (MAX_BODY // 1024 // 1024), 413, "too_large")
    try:
        data = json.loads(h.rfile.read(n).decode("utf-8"))
    except ValueError:
        raise GatewayError("جسم الطلب ليس JSON صالحًا.", 400, "bad_request")
    if not isinstance(data, dict):
        raise GatewayError("جسم الطلب غير صالح.", 400, "bad_request")
    return data


def _sse(h, req) -> None:
    cancel = Cancel()
    q: "queue.Queue" = queue.Queue()
    done = object()

    def pump() -> None:
        try:
            for ev in service.run_chat(req, cancel):
                q.put(ev)
        except Exception as e:                                   # حماية أخيرة
            q.put({"t": "error", "msg": "خطأ داخلي في البوابة: %s" % str(e)[:120]})
        finally:
            q.put(done)

    h.send_response(200)
    h.send_header("Content-Type", "text/event-stream; charset=utf-8")
    h.send_header("Cache-Control", "no-store")
    h.send_header("X-Accel-Buffering", "no")
    h.send_header("Connection", "close")
    _cors(h)
    h.end_headers()
    threading.Thread(target=pump, daemon=True).start()
    try:
        while True:
            try:
                ev = q.get(timeout=_PING_EVERY)
            except queue.Empty:
                h.wfile.write(b": ping\n\n")                     # يبقي الاتصال حيًّا ويكشف انقطاع المتصفح مبكرًا
                h.wfile.flush()
                continue
            if ev is done:
                break
            h.wfile.write(b"data: " + json.dumps(ev, ensure_ascii=False).encode("utf-8") + b"\n\n")
            h.wfile.flush()
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
        pass
    finally:
        cancel.cancel()                                          # المتصفح غادر → أوقف التوليد عند المزوّد


def handle(h, method: str) -> bool:
    """يعالج الطلب إن كان ضمن /api/gw/ ويعيد True، وإلا يعيد False ليتولاه الخادم الثابت."""
    path = urlparse(h.path).path
    if not path.startswith(PREFIX):
        return False
    route = path[len(PREFIX):].strip("/")
    if method == "OPTIONS":
        h.send_response(204)
        _cors(h)
        h.send_header("Access-Control-Max-Age", "600")
        h.end_headers()
        return True
    denied = check_access(h)
    if denied:
        _json(h, denied[0], {"ok": False, "error": denied[1], "code": "forbidden"})
        return True
    try:
        if method == "GET" and route == "health":
            _json(h, 200, {"ok": True, "version": __version__, "token": bool(_token())})
        elif method == "POST" and route in ("chat", "once", "image", "models", "search", "fetch"):
            body = _read_body(h)
            if route == "search":
                _json(h, 200, web.run_search(body))
            elif route == "fetch":
                _json(h, 200, web.fetch_page(body))
            elif route == "models":
                _json(h, 200, service.run_models(body))
            elif route == "image":
                _json(h, 200, service.run_image(body))
            elif route == "once":
                _json(h, 200, service.run_once(service.build_request(body, stream=False)))
            else:
                _sse(h, service.build_request(body, stream=True))
        elif method == "POST" and route.startswith("int/") and route[4:] in integrations.OPS:
            _json(h, 200, integrations.run(route[4:], _read_body(h)))
        elif method == "POST" and route.startswith("tasks/") and route[6:] in tasks.OPS:
            _json(h, 200, tasks.run_op(route[6:], _read_body(h)))
        elif method == "POST" and route.startswith("mail/") and route[5:] in mail.OPS:
            _json(h, 200, mail.run(route[5:], _read_body(h)))
        elif (route.startswith("store/") or route == "files" or route.startswith("files/")) and _store_route(h, method, route):
            pass
        else:
            _json(h, 404, {"ok": False, "error": "مسار غير معروف", "code": "not_found"})
    except GatewayError as e:
        _json(h, e.status or 400, {"ok": False, "error": e.message, "code": e.code, "status": e.status})
    except (BrokenPipeError, ConnectionResetError):
        pass
    except Exception as e:
        _json(h, 500, {"ok": False, "error": "خطأ داخلي في البوابة: %s" % str(e)[:160], "code": "internal"})
    return True
