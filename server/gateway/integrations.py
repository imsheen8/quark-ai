"""
التكاملات: استدعاء واجهات API خارجية بإعدادات يضبطها المستخدم، وإرسال Webhooks موقَّعة.

العمليات (POST /api/gw/int/<op>):
  call      استدعاء API: {integration:{base_url,auth_type,auth_header,auth_param,api_key}, method, path, params, body}
  webhook   إرسال حدث موقَّع: {url, secret, event, data}

مبادئ الأمان:
  - المسار نسبي فقط (يبدأ بـ «/»)، بلا مخطط ولا «#» ولا «..» ولا أسطر جديدة.
  - عنوان التكامل أساسي نظيف: http/https بلا حساب مستخدم ولا استعلام.
  - عناوين الحلقة المحلية/المترجمة (metadata) محجوبة دائمًا. الشبكة الخاصة (LAN) مسموحة للتكاملات
    لأن معظمها خدمات منزلية، وتُحجب بـ QUARK_GW_INT_BLOCK_PRIVATE=1. أما Webhooks فللعناوين العامة فقط.
  - يُحلّ الاسم مرة واحدة ثم يُتصل بالعنوان الذي تم التحقق منه نفسه (لا يمكن للـ DNS تغيير الوجهة بين الفحص والاتصال).
  - لا تُتبع التحويلات (3xx تُعاد كما هي)، والرد يُقتطع، والمفتاح لا يظهر في أي رسالة خطأ.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import http.client
import ipaddress
import json
import os
import re
import socket
import time
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple

from .errors import GatewayError
from .transport import ssl_context

TIMEOUT = 30.0
HOOK_TIMEOUT = 10.0
MAX_READ = 2 * 1024 * 1024
MAX_TEXT = 12000
METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD")
AUTH_TYPES = ("none", "bearer", "header", "query", "basic")
META_HOSTS = {"metadata.google.internal", "metadata", "instance-data"}
META_IPS = {"169.254.169.254", "100.100.100.200", "fd00:ec2::254"}
_TOKEN = re.compile(r"^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$")


def _err(msg: str, status: int = 400, code: str = "bad_request") -> GatewayError:
    return GatewayError(msg, status, code)


def _env(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


# ------------------------------------------------------------------ تحقق
def normalize_base(base: Any) -> str:
    s = str(base or "").strip()
    if not s:
        raise _err("عنوان الخدمة (Base URL) مطلوب.", 400, "bad_url")
    if re.search(r"[\s\x00-\x1f]", s):
        raise _err("عنوان الخدمة يحتوي محارف غير صالحة.", 400, "bad_url")
    p = urllib.parse.urlparse(s)
    if p.scheme.lower() not in ("http", "https") or not p.hostname:
        raise _err("عنوان الخدمة يجب أن يبدأ بـ http:// أو https://", 400, "bad_url")
    if p.username or p.password:
        raise _err("لا تضع اسم المستخدم أو كلمة المرور داخل العنوان؛ استخدم حقل المفتاح.", 400, "bad_url")
    if p.query or p.fragment:
        raise _err("عنوان الخدمة يجب ألا يحتوي استعلامًا أو «#».", 400, "bad_url")
    try:
        p.port  # noqa: B018 يرفع ValueError إن كان المنفذ غير صالح
    except ValueError:
        raise _err("منفذ غير صالح في العنوان.", 400, "bad_url")
    return urllib.parse.urlunparse(p._replace(scheme=p.scheme.lower(), netloc=p.netloc.lower())).rstrip("/")


def check_path(path: Any) -> str:
    s = str(path if path is not None else "/")
    if not s.startswith("/") or s.startswith("//"):
        raise _err("المسار يجب أن يكون نسبيًا ويبدأ بـ «/» (مثل /api/states).", 400, "bad_path")
    if re.search(r"[\s\x00-\x1f\\]", s) or "#" in s:
        raise _err("المسار يحتوي محارف غير مسموحة.", 400, "bad_path")
    raw_path = s.split("?", 1)[0]
    for seg in raw_path.split("/"):
        if urllib.parse.unquote(seg) in ("..", "."):
            raise _err("المسار لا يقبل «..».", 400, "bad_path")
    return s


def _ip_ok(ip: ipaddress._BaseAddress, block_private: bool) -> bool:
    if ip.is_link_local or ip.is_unspecified or ip.is_multicast or ip.is_reserved or str(ip) in META_IPS:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return _ip_ok(ip.ipv4_mapped, block_private)
    if block_private and (ip.is_private or ip.is_loopback or ip.is_site_local):
        return False
    return True


def resolve(host: str, port: int, block_private: bool) -> List[str]:
    """يعيد عناوين IP صالحة فقط؛ يرفض إن وُجد أي عنوان محجوب (حماية من DNS المزدوج)."""
    if host.lower().strip(".") in META_HOSTS:
        raise _err("وجهة محجوبة.", 403, "blocked")
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError:
        raise _err("تعذّر العثور على الخادم (%s)." % host, 502, "dns")
    out: List[str] = []
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0].split("%")[0])
        except ValueError:
            continue
        if not _ip_ok(ip, block_private):
            raise _err("وجهة محجوبة (%s)." % ("عنوان خاص أو داخلي" if block_private else "عنوان داخلي"), 403, "blocked")
        if str(ip) not in out:
            out.append(str(ip))
    if not out:
        raise _err("تعذّر تحديد عنوان الخادم.", 502, "dns")
    return out


# ------------------------------------------------------------------ اتصال مثبّت
def _connect(scheme: str, host: str, port: int, ips: List[str], timeout: float) -> http.client.HTTPConnection:
    last: Optional[Exception] = None
    for ip in ips:
        try:
            sock = socket.create_connection((ip, port), timeout=timeout)
            if scheme == "https":
                sock = ssl_context().wrap_socket(sock, server_hostname=host)
            conn = http.client.HTTPConnection(host, port, timeout=timeout)
            conn.sock = sock                      # الاتصال بالعنوان المتحقق منه، والـ Host/SNI للاسم الأصلي
            return conn
        except Exception as e:  # noqa: BLE001
            last = e
    raise _net_error(last)


def _net_error(e: Optional[Exception]) -> GatewayError:
    import ssl
    if isinstance(e, ssl.SSLError):
        return _err("فشل التحقق من شهادة الخادم. إن كان محليًا بشهادة ذاتية فعّل QUARK_GW_INSECURE=1.", 502, "ssl")
    if isinstance(e, (socket.timeout, TimeoutError)):
        return _err("انتهت مهلة الاتصال بالخدمة.", 504, "timeout")
    if isinstance(e, ConnectionRefusedError):
        return _err("رفضت الخدمة الاتصال. تحقق من العنوان والمنفذ.", 502, "refused")
    return _err("تعذّر الاتصال بالخدمة: %s" % (str(e)[:100] if e else "خطأ غير معروف"), 502, "network")


def _do(method: str, url: str, headers: Dict[str, str], body: Optional[bytes], block_private: bool,
        timeout: float) -> Tuple[int, Dict[str, str], bytes]:
    p = urllib.parse.urlparse(url)
    scheme = p.scheme.lower()
    host = p.hostname or ""
    port = p.port or (443 if scheme == "https" else 80)
    ips = resolve(host, port, block_private)
    target = (p.path or "/") + (("?" + p.query) if p.query else "")
    conn = _connect(scheme, host, port, ips, timeout)
    try:
        conn.request(method, target, body=body, headers=headers)
        resp = conn.getresponse()
        raw = resp.read(MAX_READ + 1)[:MAX_READ] if method != "HEAD" else b""
        return resp.status, {k.lower(): v for k, v in resp.getheaders()}, raw
    except GatewayError:
        raise
    except Exception as e:  # noqa: BLE001
        raise _net_error(e)
    finally:
        try:
            conn.close()
        except Exception:
            pass


# ------------------------------------------------------------------ استدعاء API
def _hval(v: Any, what: str) -> str:
    s = str(v if v is not None else "")
    if re.search(r"[\r\n\x00]", s):
        raise _err("قيمة غير صالحة في %s." % what, 400, "bad_header")
    return s


def build_request(integ: dict, method: str, path: str, params: Any, body: Any) -> Tuple[str, Dict[str, str], Optional[bytes]]:
    base = normalize_base(integ.get("base_url"))
    path = check_path(path)
    method = str(method or "GET").upper()
    if method not in METHODS:
        raise _err("طريقة HTTP غير مدعومة: %s" % method, 400, "bad_method")
    auth = str(integ.get("auth_type") or "none").lower()
    if auth not in AUTH_TYPES:
        raise _err("نوع المصادقة غير معروف.", 400, "bad_auth")
    key = _hval(integ.get("api_key"), "المفتاح")

    query: List[Tuple[str, str]] = []
    if isinstance(params, dict):
        for k, v in params.items():
            if isinstance(v, (list, tuple)):
                query += [(str(k), str(x)) for x in v]
            elif v is not None:
                query.append((str(k), str(v).lower() if isinstance(v, bool) else str(v)))
    headers: Dict[str, str] = {"User-Agent": "QUARK-AI/1.0", "Accept": "application/json, text/plain;q=0.9, */*;q=0.5"}
    if key:
        if auth == "bearer":
            headers["Authorization"] = "Bearer " + key
        elif auth == "header":
            name = _hval(integ.get("auth_header") or "Authorization", "اسم الترويسة")
            if not _TOKEN.match(name):
                raise _err("اسم ترويسة المصادقة غير صالح.", 400, "bad_header")
            headers[name] = key
        elif auth == "query":
            pname = str(integ.get("auth_param") or "api_key")
            query.append((pname, key))
        elif auth == "basic":
            headers["Authorization"] = "Basic " + base64.b64encode(key.encode("utf-8")).decode("ascii")

    data: Optional[bytes] = None
    if body not in (None, "", {}, []) and method not in ("GET", "HEAD"):
        if isinstance(body, (dict, list)):
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        else:
            data = str(body).encode("utf-8")
            headers["Content-Type"] = "text/plain; charset=utf-8"
    if data is not None:
        headers["Content-Length"] = str(len(data))

    url = base + ("" if path == "/" and urllib.parse.urlparse(base).path else path)
    if url == base and not urllib.parse.urlparse(base).path:
        url = base + "/"
    if query:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(query)
    return url, headers, data


def shape_body(raw: bytes, ctype: str) -> Tuple[str, bool, int]:
    text = raw.decode("utf-8", "replace")
    if "json" in (ctype or "").lower():
        try:
            text = json.dumps(json.loads(text), ensure_ascii=False, indent=1)
        except ValueError:
            pass
    total = len(text)
    if total > MAX_TEXT:
        return text[:MAX_TEXT] + "\n… (مقتطع، الإجمالي %d حرفًا)" % total, True, total
    return text, False, total


def call(body: dict) -> dict:
    integ = body.get("integration")
    if not isinstance(integ, dict):
        raise _err("بيانات التكامل مفقودة.", 400, "bad_request")
    url, headers, data = build_request(integ, body.get("method"), body.get("path"), body.get("params"), body.get("body"))
    t0 = time.time()
    status, hdr, raw = _do(str(body.get("method") or "GET").upper(), url, headers, data,
                           _env("QUARK_GW_INT_BLOCK_PRIVATE"), TIMEOUT)
    text, trunc, total = shape_body(raw, hdr.get("content-type", ""))
    out = {"ok": True, "status": status, "content_type": hdr.get("content-type", ""), "body": text,
           "truncated": trunc, "total": total, "ms": int((time.time() - t0) * 1000)}
    if 300 <= status < 400 and hdr.get("location"):
        out["location"] = hdr["location"][:500]
    return out


# ------------------------------------------------------------------ Webhooks موقَّعة
HOOK_EVENTS = ("session.created", "chat.message", "chat.completed", "webhook.test")


def sign(secret: str, ts: str, payload: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode("utf-8"), ts.encode("ascii") + b"." + payload, hashlib.sha256).hexdigest()


def webhook(body: dict) -> dict:
    url = str(body.get("url") or "").strip()
    p = urllib.parse.urlparse(url)
    if p.scheme.lower() not in ("http", "https") or not p.hostname or p.username or p.password or re.search(r"[\s\x00-\x1f]", url):
        raise _err("رابط الـ Webhook غير صالح.", 400, "bad_url")
    event = str(body.get("event") or "")
    if event not in HOOK_EVENTS:
        raise _err("حدث غير معروف: %s" % event, 400, "bad_event")
    secret = str(body.get("secret") or "")
    ts = str(int(time.time()))
    payload = json.dumps({"event": event, "timestamp": int(ts), "data": body.get("data") if isinstance(body.get("data"), dict) else {}},
                         ensure_ascii=False).encode("utf-8")
    headers = {"User-Agent": "QUARK-AI/1.0", "Content-Type": "application/json", "Content-Length": str(len(payload)),
               "X-Quark-Event": event, "X-Quark-Timestamp": ts}
    if secret:
        headers["X-Quark-Signature"] = sign(secret, ts, payload)
    target = url if p.path else url + "/"
    status, _, _ = _do("POST", target, headers, payload, not _env("QUARK_GW_FETCH_PRIVATE"), HOOK_TIMEOUT)
    return {"ok": True, "status": status, "delivered": 200 <= status < 300}


def run(op: str, body: dict) -> dict:
    if op == "call":
        return call(body)
    if op == "webhook":
        return webhook(body)
    raise _err("عملية تكامل غير معروفة.", 404, "not_found")


OPS = ("call", "webhook")
