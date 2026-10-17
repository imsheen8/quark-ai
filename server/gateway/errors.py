"""تحويل أخطاء المزوّدين والشبكة إلى رسائل عربية مفهومة."""
from __future__ import annotations

import json
import re
import socket
import ssl
from typing import Optional

from .providers import Endpoint


class GatewayError(Exception):
    def __init__(self, message: str, status: Optional[int] = None, code: str = "error", retryable: bool = False):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.retryable = retryable


def body_text(body) -> str:
    if isinstance(body, bytes):
        return body.decode("utf-8", "replace")
    return str(body or "")


def extract_detail(body) -> str:
    """يستخرج جملة الخطأ من الأشكال الشائعة لأجسام الأخطاء."""
    raw = body_text(body).strip()
    if not raw:
        return ""
    try:
        j = json.loads(raw)
    except ValueError:
        return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", raw))[:300].strip()
    if isinstance(j, list) and j:
        j = j[0]
    if isinstance(j, dict):
        err = j.get("error", j)
        if isinstance(err, dict):
            msg = err.get("message") or err.get("detail") or err.get("error") or ""
            if isinstance(msg, (dict, list)):
                msg = json.dumps(msg, ensure_ascii=False)
            return str(msg).strip()[:300]
        if isinstance(err, str):
            return err.strip()[:300]
        d = j.get("detail") or j.get("message")
        if d:
            return (d if isinstance(d, str) else json.dumps(d, ensure_ascii=False))[:300]
    return raw[:300]


_CTX = re.compile(r"(context[_ ]length|maximum context|context window|too many tokens|token limit|prompt is too long|exceeds the (maximum|max)|reduce the length|input is too long)", re.I)
_BAD_KEY = re.compile(r"(api[_ ]?key (is )?(not valid|invalid|missing)|invalid[_ ](x-)?api[_ ]?key|incorrect api key|unauthorized|invalid_api_key|authentication)", re.I)
_QUOTA = re.compile(r"(insufficient[_ ]quota|exceeded your current quota|billing|credit balance|out of credits|insufficient (funds|balance))", re.I)
_REGION = re.compile(r"(not (available|supported) in your (region|country)|unsupported_country|location is not supported)", re.I)
_SAFETY = re.compile(r"(content[_ ]filter|safety|blocked|policy violation|responsible ai)", re.I)
_MODEL = re.compile(r"(model[^.]{0,40}(not found|does not exist|not supported|unknown|invalid)|no such model|unknown model)", re.I)


def from_http(status: int, body, ep: Endpoint) -> GatewayError:
    detail = extract_detail(body)
    raw = body_text(body)
    probe = detail + " " + raw[:600]
    label = ep.label or "المزوّد"
    tail = (" — " + detail) if detail else ""

    if status in (400, 413, 422) and _CTX.search(probe):
        return GatewayError("المحادثة أطول من نافذة سياق النموذج. ابدأ محادثة جديدة أو قلّل حجم الرسائل والمرفقات." + tail, status, "context_length")
    if status in (401, 403) or (status == 400 and _BAD_KEY.search(probe)):
        if status == 403 and _REGION.search(probe):
            return GatewayError(label + ": الخدمة غير متاحة في منطقتك." + tail, status, "region")
        if status == 403 and _QUOTA.search(probe):
            return GatewayError(label + ": الرصيد أو الحصة غير كافية." + tail, status, "quota")
        what = "المفتاح مرفوض" if status != 403 else "تم رفض الوصول (403)"
        return GatewayError("%s: %s — تحقق من المفتاح ومن صلاحياته في الإعدادات.%s" % (label, what, tail), status, "auth")
    if status == 402 or (status == 429 and _QUOTA.search(probe)):
        return GatewayError(label + ": الرصيد أو الحصة غير كافية، أضف رصيدًا أو غيّر الخطة." + tail, status, "quota")
    if status == 404:
        if _MODEL.search(probe):
            return GatewayError("%s: النموذج غير موجود أو لا يملك مفتاحك صلاحية عليه — راجع معرّف النموذج.%s" % (label, tail), status, "model")
        return GatewayError("%s: لم يُعثر على العنوان (404) — راجع عنوان API ومعرّف النموذج.%s" % (label, tail), status, "not_found")
    if status in (408, 504):
        return GatewayError(label + ": انتهت مهلة الاستجابة." + tail, status, "timeout", True)
    if status == 429:
        return GatewayError(label + ": تجاوزت حد الطلبات، انتظر قليلًا ثم أعد المحاولة." + tail, status, "rate_limit", True)
    if status in (500, 502, 503, 529):
        word = "مزدحم حاليًا" if status in (503, 529) else "يواجه عطلًا مؤقتًا"
        return GatewayError("%s %s (HTTP %d).%s" % (label, word, status, tail), status, "overloaded", True)
    if status >= 500:
        return GatewayError("%s: خطأ في الخادم (HTTP %d).%s" % (label, status, tail), status, "server", True)
    if _SAFETY.search(probe):
        return GatewayError(label + ": رُفض الطلب بسبب سياسات المحتوى." + tail, status, "safety")
    return GatewayError("%s: طلب غير مقبول (HTTP %d).%s" % (label, status, tail), status, "bad_request")


def from_exception(exc: BaseException, ep: Endpoint) -> GatewayError:
    if isinstance(exc, GatewayError):
        return exc
    reason = getattr(exc, "reason", exc)
    label = ep.label or "المزوّد"
    where = ep.origin
    if isinstance(reason, (socket.timeout, TimeoutError)) or "timed out" in str(reason).lower():
        return GatewayError(label + ": انتهت مهلة الاتصال. تأكد من العنوان ومن اتصال الإنترنت.", None, "timeout", True)
    if isinstance(reason, ssl.SSLError) or "CERTIFICATE" in str(reason).upper():
        return GatewayError("%s: فشل التحقق من شهادة HTTPS (%s). إن كان الخادم محليًا بشهادة ذاتية فعّل QUARK_GW_INSECURE=1." % (label, where), None, "ssl")
    if isinstance(reason, socket.gaierror):
        return GatewayError("تعذّر العثور على الخادم %s — تحقق من كتابة العنوان ومن الاتصال بالإنترنت." % ep.host, None, "dns")
    if isinstance(reason, ConnectionRefusedError):
        hint = ""
        if ep.label == "Ollama":
            hint = " تأكد أن Ollama يعمل (ollama serve)."
        elif ep.label == "LM Studio":
            hint = " شغّل الخادم المحلي من LM Studio."
        elif ep.local:
            hint = " تأكد أن الخادم يعمل على هذا المنفذ."
        return GatewayError("رُفض الاتصال بـ %s.%s" % (where, hint), None, "refused")
    if isinstance(reason, (ConnectionError, BrokenPipeError)):
        return GatewayError("انقطع الاتصال بـ %s أثناء الرد." % label, None, "network", True)
    msg = str(reason) or exc.__class__.__name__
    return GatewayError("%s: تعذّر الاتصال (%s)." % (label, msg[:160]), None, "network", True)
