"""
أدوات الويب للبحث العميق: البحث عبر مزوّدي البحث + جلب الصفحات واستخراج نصها.

- مكتبة بايثون القياسية فقط.
- حماية SSRF: يُرفض أي عنوان يشير إلى الجهاز نفسه أو الشبكة الداخلية (يشمل كل إعادة توجيه)،
  إلا إذا عُيّن QUARK_GW_FETCH_PRIVATE=1.
- محتوى الصفحات يُعاد كنص خام؛ التعامل معه كبيانات غير موثوقة مسؤولية الواجهة.
"""
from __future__ import annotations

import html as _html
import ipaddress
import json
import os
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from typing import Dict, List, Optional

from .errors import GatewayError
from .transport import ssl_context

UA = "Mozilla/5.0 (compatible; QUARK-AI-Research/1.0; +https://localhost)"
MAX_BYTES = 2_500_000
MAX_TEXT = 30_000
FETCH_TIMEOUT = float(os.environ.get("QUARK_GW_FETCH_TIMEOUT", "25"))
PROVIDERS = ("duckduckgo", "searxng", "tavily", "brave", "serper", "google_pse")


# --------------------------------------------------------------------- حماية الشبكة
def _allow_private() -> bool:
    return os.environ.get("QUARK_GW_FETCH_PRIVATE", "").strip().lower() in ("1", "true", "yes", "on")


def check_url(url: str, allow_private: bool = False) -> urllib.parse.ParseResult:
    p = urllib.parse.urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise GatewayError("رابط غير صالح (يجب أن يبدأ بـ http أو https).", 400, "bad_url")
    if allow_private or _allow_private():
        return p
    try:
        infos = socket.getaddrinfo(p.hostname, p.port or (443 if p.scheme == "https" else 80), type=socket.SOCK_STREAM)
    except OSError:
        raise GatewayError("تعذّر العثور على الموقع (%s)." % p.hostname, 502, "dns")
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0].split("%")[0])
        except ValueError:
            continue
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise GatewayError("الوصول إلى عناوين الشبكة الداخلية غير مسموح في جلب الصفحات.", 403, "blocked")
    return p


class _Redirect(urllib.request.HTTPRedirectHandler):
    max_redirections = 5

    def __init__(self, allow_private: bool) -> None:
        self.allow_private = allow_private

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(newurl, self.allow_private)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _open(url: str, *, headers: Optional[Dict[str, str]] = None, data: Optional[bytes] = None,
          method: str = "GET", timeout: float = FETCH_TIMEOUT, allow_private: bool = False):
    check_url(url, allow_private)
    hdrs = {"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5",
            "Accept-Language": "ar,en;q=0.8"}
    hdrs.update(headers or {})
    opener = urllib.request.build_opener(_Redirect(allow_private), urllib.request.HTTPSHandler(context=ssl_context()))
    try:
        return opener.open(urllib.request.Request(url, data=data, headers=hdrs, method=method), timeout=timeout)
    except urllib.error.HTTPError as e:
        raise GatewayError("رفض الموقع الطلب (%d)." % e.code, e.code, "http_%d" % e.code, retryable=e.code in (429, 500, 502, 503))
    except GatewayError:
        raise
    except Exception as e:
        raise GatewayError("تعذّر الاتصال بالموقع: %s" % (str(e)[:100] or e.__class__.__name__), 502, "network")


def _read(resp, limit: int = MAX_BYTES) -> bytes:
    try:
        return resp.read(limit + 1)[:limit]
    finally:
        try:
            resp.close()
        except Exception:
            pass


def _decode(raw: bytes, ctype_header: str) -> str:
    cs = None
    m = re.search(r"charset=([\w\-]+)", ctype_header or "", re.I)
    if m:
        cs = m.group(1)
    if not cs:
        m = re.search(rb"<meta[^>]+charset=[\"']?([\w\-]+)", raw[:4096], re.I)
        if m:
            cs = m.group(1).decode("ascii", "ignore")
    for enc in (cs, "utf-8", "cp1256", "latin-1"):
        if not enc:
            continue
        try:
            return raw.decode(enc)
        except (LookupError, UnicodeDecodeError):
            continue
    return raw.decode("utf-8", "replace")


# --------------------------------------------------------------------- استخراج النص
_SKIP = {"script", "style", "noscript", "svg", "nav", "footer", "aside", "form", "iframe", "template", "button", "select", "head"}
_BLOCK = {"p", "div", "section", "article", "main", "li", "tr", "br", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "table", "ul", "ol", "dd", "dt"}
_NOISE = re.compile(r"(cookie|consent|banner|advert|sidebar|breadcrumb|share|social|newsletter|popup|modal|comment)", re.I)


class _Extract(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.desc = ""
        self.image = ""
        self._skip = 0
        self._noise: List[str] = []
        self._in_title = False
        self._head: Optional[str] = None
        self.parts: List[str] = []
        self.main: List[str] = []
        self._main_depth = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta":
            k = (a.get("property") or a.get("name") or "").lower()
            v = (a.get("content") or "").strip()
            if k in ("og:description", "description", "twitter:description") and v and not self.desc:
                self.desc = v
            elif k in ("og:image", "twitter:image") and v and not self.image:
                self.image = v
            elif k == "og:title" and v and not self.title:
                self.title = v
            return
        if tag == "title":
            self._in_title = True
            return
        if tag in _SKIP:
            self._skip += 1
            return
        cls = (a.get("class") or "") + " " + (a.get("id") or "")
        if self._skip == 0 and tag in ("div", "section", "ul", "span") and _NOISE.search(cls):
            self._skip += 1
            self._noise.append(tag)
            return
        if tag in ("article", "main"):
            self._main_depth += 1
        if self._skip:
            return
        if tag in _BLOCK:
            self._emit("\n")
        if tag in ("h1", "h2", "h3", "h4"):
            self._head = "#" * min(int(tag[1]) + 0, 4) + " "
            self._emit("\n" + self._head)
        elif tag == "li":
            self._emit("- ")

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
            return
        if tag in _SKIP:
            self._skip = max(0, self._skip - 1)
            return
        if self._noise and tag == self._noise[-1] and self._skip:
            self._noise.pop()
            self._skip = max(0, self._skip - 1)
            return
        if tag in ("article", "main"):
            self._main_depth = max(0, self._main_depth - 1)
        if self._skip:
            return
        if tag in _BLOCK or tag in ("h1", "h2", "h3", "h4"):
            self._emit("\n")
            self._head = None

    def _emit(self, s: str) -> None:
        self.parts.append(s)
        if self._main_depth:
            self.main.append(s)

    def handle_data(self, data):
        if self._in_title:
            self.title += data
            return
        if self._skip:
            return
        t = re.sub(r"\s+", " ", data)
        if t.strip():
            self._emit(t)


def _clean(parts: List[str]) -> str:
    text = "".join(parts)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    lines = [ln.rstrip() for ln in text.split("\n")]
    out, seen = [], set()
    for ln in lines:                                   # يحذف الأسطر القصيرة المكررة (قوائم تنقّل متبقية)
        key = ln.strip()
        if key and len(key) < 40 and key in seen:
            continue
        seen.add(key)
        out.append(ln)
    return "\n".join(out).strip()


def extract_text(html: str):
    p = _Extract()
    try:
        p.feed(html)
        p.close()
    except Exception:
        pass
    main = _clean(p.main)
    body = _clean(p.parts)
    text = main if len(main) > 600 else body
    title = re.sub(r"\s+", " ", _html.unescape(p.title)).strip()
    return title, p.desc.strip(), p.image.strip(), text


def fetch_page(body: dict) -> dict:
    url = str(body.get("url") or "").strip()
    limit = int(max(2000, min(float(body.get("max_chars") or 16000), MAX_TEXT)))
    resp = _open(url)
    final = resp.geturl()
    ctype = (resp.headers.get("Content-Type") or "").lower()
    raw = _read(resp)
    if "pdf" in ctype or raw[:4] == b"%PDF":
        raise GatewayError("الملف بصيغة PDF وهي غير مدعومة في جلب الصفحات.", 415, "unsupported")
    if ctype and not any(k in ctype for k in ("html", "text", "xml", "json")):
        raise GatewayError("نوع المحتوى غير مدعوم (%s)." % ctype.split(";")[0], 415, "unsupported")
    txt = _decode(raw, ctype)
    if "html" in ctype or "<html" in txt[:2000].lower() or "<body" in txt[:5000].lower():
        title, desc, image, text = extract_text(txt)
    else:
        title, desc, image, text = "", "", "", txt.strip()
    image = urllib.parse.urljoin(final, image) if image else ""
    if image and not image.startswith(("http://", "https://")):
        image = ""
    return {"ok": True, "url": url, "final_url": final, "title": title[:300], "description": desc[:500], "image": image,
            "text": text[:limit], "truncated": len(text) > limit, "chars": len(text)}


# --------------------------------------------------------------------- مزوّدو البحث
def _norm(items, tk, uk, ck) -> List[dict]:
    out, seen = [], set()
    for it in items or []:
        if not isinstance(it, dict):
            continue
        u = str(it.get(uk) or "").strip()
        if not u.startswith(("http://", "https://")) or u in seen:
            continue
        seen.add(u)
        out.append({"title": re.sub(r"\s+", " ", str(it.get(tk) or "")).strip()[:300], "url": u,
                    "snippet": re.sub(r"\s+", " ", str(it.get(ck) or "")).strip()[:600]})
    return out


def _json_req(url: str, *, headers=None, payload=None, method="GET", allow_private=False) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    h = {"Accept": "application/json"}
    if data is not None:
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    raw = _read(_open(url, headers=h, data=data, method=method, timeout=30, allow_private=allow_private))
    try:
        return json.loads(raw.decode("utf-8", "replace"))
    except ValueError:
        raise GatewayError("ردّ مزوّد البحث ليس JSON صالحًا.", 502, "bad_response")


class _DDG(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.items: List[dict] = []
        self._cur: Optional[dict] = None
        self._mode = ""

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class") or ""
        if tag == "a" and "result__a" in cls:
            href = a.get("href") or ""
            q = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
            if "uddg" in q:
                href = q["uddg"][0]
            elif href.startswith("//"):
                href = "https:" + href
            self._cur = {"title": "", "url": href, "snippet": ""}
            self.items.append(self._cur)
            self._mode = "t"
        elif tag in ("a", "div", "td") and "result__snippet" in cls and self.items:
            self._cur = self.items[-1]
            self._mode = "s"

    def handle_endtag(self, tag):
        if tag in ("a", "div", "td"):
            self._mode = ""

    def handle_data(self, data):
        if self._cur is None:
            return
        if self._mode == "t":
            self._cur["title"] += data
        elif self._mode == "s":
            self._cur["snippet"] += data


def _ddg(query: str, n: int) -> List[dict]:
    form = urllib.parse.urlencode({"q": query, "kl": "wt-wt"}).encode()
    resp = _open("https://html.duckduckgo.com/html/", data=form, method="POST", timeout=25,
                 headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "text/html"})
    page = _decode(_read(resp), resp.headers.get("Content-Type") or "")
    p = _DDG()
    p.feed(page)
    items = [i for i in p.items if "duckduckgo.com/y.js" not in i["url"]]
    out = _norm(items, "title", "url", "snippet")
    if not out and re.search(r"(anomaly|captcha|unusual traffic)", page, re.I):
        raise GatewayError("DuckDuckGo حجب الطلب مؤقتًا (حماية ضد الأتمتة). جرّب لاحقًا أو اختر مزوّد بحث آخر بمفتاح.", 429, "search_blocked")
    return out[:n]


def run_search(body: dict) -> dict:
    query = str(body.get("query") or "").strip()
    if not query:
        raise GatewayError("استعلام البحث فارغ.", 400, "bad_request")
    provider = str(body.get("provider") or "duckduckgo").lower()
    if provider not in PROVIDERS:
        raise GatewayError("مزوّد بحث غير معروف.", 400, "bad_request")
    n = int(max(1, min(float(body.get("max_results") or 8), 20)))
    key = str(body.get("key") or "").strip()
    if provider in ("tavily", "brave", "serper", "google_pse") and not key:
        raise GatewayError("مزوّد البحث %s يحتاج مفتاح API (أدخله في إعدادات البحث العميق)." % provider, 400, "no_key")
    q = query[:400]
    if provider == "duckduckgo":
        res = _ddg(q, n)
    elif provider == "searxng":
        base = str(body.get("url") or "").strip().rstrip("/")
        if not base:
            raise GatewayError("أدخل عنوان خادم SearXNG في إعدادات البحث العميق.", 400, "no_key")
        j = _json_req(base + "/search?" + urllib.parse.urlencode({"q": q, "format": "json"}), allow_private=True)
        res = _norm(j.get("results"), "title", "url", "content")[:n]
    elif provider == "tavily":
        j = _json_req("https://api.tavily.com/search", method="POST", payload={"api_key": key, "query": q, "max_results": n})
        res = _norm(j.get("results"), "title", "url", "content")[:n]
    elif provider == "brave":
        j = _json_req("https://api.search.brave.com/res/v1/web/search?" + urllib.parse.urlencode({"q": q, "count": n}),
                      headers={"X-Subscription-Token": key})
        res = _norm((j.get("web") or {}).get("results"), "title", "url", "description")[:n]
    elif provider == "google_pse":
        cx = str(body.get("cx") or "").strip()
        if not cx:
            raise GatewayError("مزوّد Google PSE يحتاج معرّف محرك البحث (CX) في إعدادات البحث العميق.", 400, "no_key")
        j = _json_req("https://www.googleapis.com/customsearch/v1?" + urllib.parse.urlencode({"key": key, "cx": cx, "q": q, "num": min(n, 10)}))
        res = _norm(j.get("items"), "title", "link", "snippet")[:n]
    else:
        j = _json_req("https://google.serper.dev/search", method="POST", headers={"X-API-KEY": key}, payload={"q": q, "num": n})
        res = _norm(j.get("organic"), "title", "link", "snippet")[:n]
    return {"ok": True, "provider": provider, "query": q, "results": res}
