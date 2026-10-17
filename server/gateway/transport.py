"""
طبقة النقل: طلبات HTTP نحو المزوّدين (مكتبة بايثون القياسية فقط).

- تدعم متغيرات الوكيل (HTTP_PROXY / HTTPS_PROXY) تلقائيًا.
- تقرأ البث سطرًا بسطر، ويمكن إلغاؤها من خيط آخر (عند انقطاع المتصفح).
"""
from __future__ import annotations

import json
import os
import ssl
import threading
import time
import urllib.error
import urllib.request
from typing import Dict, Iterator, Optional

from .errors import GatewayError, from_exception, from_http
from .providers import Endpoint

USER_AGENT = "QUARK-AI-Gateway/1.0"
CONNECT_TIMEOUT = float(os.environ.get("QUARK_GW_CONNECT_TIMEOUT", "60"))
READ_TIMEOUT = float(os.environ.get("QUARK_GW_TIMEOUT", "300"))

_ssl_ctx: Optional[ssl.SSLContext] = None


def ssl_context() -> ssl.SSLContext:
    global _ssl_ctx
    if _ssl_ctx is None:
        ctx = ssl.create_default_context()
        if os.environ.get("QUARK_GW_INSECURE", "").strip() in ("1", "true", "yes"):
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        _ssl_ctx = ctx
    return _ssl_ctx


class Cancel:
    """رمز إلغاء: عند استدعاء cancel() يُغلق الاتصال الجاري فيتوقف التوليد عند المزوّد."""

    def __init__(self) -> None:
        self._resp = None
        self._lock = threading.Lock()
        self.cancelled = False

    def attach(self, resp) -> None:
        with self._lock:
            self._resp = resp
            if self.cancelled:
                self._close_quiet(resp)

    def cancel(self) -> None:
        with self._lock:
            self.cancelled = True
            resp, self._resp = self._resp, None
        if resp is not None:
            self._close_quiet(resp)

    @staticmethod
    def _close_quiet(resp) -> None:
        try:
            resp.close()
        except Exception:
            pass


def _set_read_timeout(resp, seconds: float) -> None:
    """بعد وصول الترويسات نوسّع مهلة القراءة (التفكير الطويل قد يصمت دقائق)."""
    try:
        resp.fp.raw._sock.settimeout(seconds)          # type: ignore[attr-defined]
    except Exception:
        pass


def open_request(ep: Endpoint, url: str, headers: Dict[str, str], payload: Optional[dict], *,
                 method: str = "POST", cancel: Optional[Cancel] = None,
                 timeout: Optional[float] = None, retries: int = 1):
    """يفتح الطلب ويعيد استجابة جاهزة للقراءة، أو يرفع GatewayError بصياغة عربية."""
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    hdrs = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    if data is not None:
        hdrs["Content-Type"] = "application/json"
    hdrs.update(headers)
    attempt = 0
    while True:
        if cancel and cancel.cancelled:
            raise GatewayError("أُلغي الطلب", None, "cancelled")
        req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
        try:
            resp = urllib.request.urlopen(req, timeout=timeout or CONNECT_TIMEOUT, context=ssl_context())
            if cancel:
                cancel.attach(resp)
            _set_read_timeout(resp, READ_TIMEOUT)
            return resp
        except urllib.error.HTTPError as e:
            try:
                body = e.read()
            except Exception:
                body = b""
            err = from_http(e.code, body, ep)
            if err.retryable and attempt < retries and e.code != 408:
                wait = 1.0
                ra = e.headers.get("Retry-After") if e.headers else None
                if ra and ra.strip().isdigit():
                    wait = min(float(ra), 5.0)
                attempt += 1
                time.sleep(wait)
                continue
            err.raw_body = body            # type: ignore[attr-defined]
            raise err
        except GatewayError:
            raise
        except Exception as e:             # شبكة / DNS / SSL / مهلة
            err = from_exception(e, ep)
            if err.retryable and attempt < retries and err.code != "timeout":
                attempt += 1
                time.sleep(0.8)
                continue
            raise err


def iter_lines(resp, cancel: Optional[Cancel] = None) -> Iterator[str]:
    """يقرأ أسطر UTF-8 من الاستجابة (SSE أو NDJSON)."""
    try:
        while True:
            try:
                raw = resp.readline()
            except Exception as e:
                if cancel and cancel.cancelled:
                    return
                raise GatewayError("انقطع البث من المزوّد (%s)" % (str(e)[:80] or e.__class__.__name__), None, "network")
            if not raw:
                return
            yield raw.decode("utf-8", "replace").rstrip("\r\n")
    finally:
        try:
            resp.close()
        except Exception:
            pass


def read_json(resp) -> dict:
    try:
        raw = resp.read()
    finally:
        try:
            resp.close()
        except Exception:
            pass
    try:
        return json.loads(raw.decode("utf-8", "replace") or "{}")
    except ValueError:
        raise GatewayError("ردّ المزوّد ليس JSON صالحًا.", None, "bad_response")
