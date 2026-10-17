"""
التعرّف على المزوّد وصيغة الاتصال (dialect) من عنوان نقطة الاتصال.

القرار يعتمد على اسم المضيف (وليس على نص العنوان كاملًا) حتى لا يُخدَع بمسارات
أو معاملات تحتوي اسم مزوّد آخر.
"""
from __future__ import annotations

import ipaddress
from dataclasses import dataclass, field
from typing import Optional, Tuple
from urllib.parse import urlparse

# (لواحق المضيف, المعرّف, الاسم الظاهر)
_KNOWN = (
    (("anthropic.com",), "anthropic", "Anthropic"),
    (("openai.com",), "openai", "OpenAI"),
    (("openai.azure.com", "cognitiveservices.azure.com"), "azure", "Azure OpenAI"),
    (("openrouter.ai",), "openrouter", "OpenRouter"),
    (("groq.com",), "groq", "Groq"),
    (("deepseek.com",), "deepseek", "DeepSeek"),
    (("x.ai",), "xai", "xAI"),
    (("mistral.ai",), "mistral", "Mistral"),
    (("together.xyz", "together.ai"), "together", "Together"),
    (("fireworks.ai",), "fireworks", "Fireworks"),
    (("cerebras.ai",), "cerebras", "Cerebras"),
    (("nvidia.com",), "nvidia", "NVIDIA"),
    (("moonshot.ai", "moonshot.cn"), "moonshot", "Moonshot"),
    (("kimi.com",), "kimi", "Kimi"),
    (("siliconflow.cn", "siliconflow.com"), "siliconflow", "SiliconFlow"),
    (("perplexity.ai",), "perplexity", "Perplexity"),
    (("cohere.com", "cohere.ai"), "cohere", "Cohere"),
    (("z.ai", "bigmodel.cn"), "zai", "Z.AI"),
    (("minimax.io", "minimaxi.com"), "minimax", "MiniMax"),
    (("venice.ai",), "venice", "Venice"),
    (("github.ai", "models.inference.ai.azure.com"), "github", "GitHub Models"),
    (("ollama.com",), "ollama-cloud", "Ollama Cloud"),
    (("generativelanguage.googleapis.com",), "google", "Google Gemini"),
    (("googleapis.com",), "google", "Google"),
)

_ALWAYS_BLOCKED_HOSTS = {"169.254.169.254", "metadata.google.internal", "metadata.goog", "100.100.100.200"}
_LOOPBACK_NAMES = {"localhost", "0.0.0.0", "::1", "host.docker.internal"}

DIALECTS = ("openai", "anthropic", "gemini", "ollama")


def host_matches(host: str, *suffixes: str) -> bool:
    host = (host or "").lower().rstrip(".")
    return any(host == s or host.endswith("." + s) for s in suffixes)


def _is_private_host(host: str) -> bool:
    host = (host or "").lower().rstrip(".")
    if not host:
        return False
    if host in _LOOPBACK_NAMES or host.endswith(".local") or host.endswith(".lan") or host.endswith(".internal"):
        return True
    try:
        ip = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return "." not in host            # اسم بلا نقاط (مثل nas أو mypc) = شبكة محلية
    return not ip.is_global


class EndpointError(ValueError):
    """عنوان أو إعداد نقطة اتصال غير صالح."""


@dataclass
class Endpoint:
    url: str
    key: str = ""
    proto: str = "auto"
    kind: str = "api"
    # ---- تُحسب تلقائيًا ----
    host: str = ""
    path: str = ""
    port: Optional[int] = None
    provider: str = "custom"
    label: str = ""
    dialect: str = "openai"
    local: bool = False
    extra: dict = field(default_factory=dict)

    @property
    def origin(self) -> str:
        p = urlparse(self.url)
        return "%s://%s" % (p.scheme, p.netloc)


def _clean_base(url: str) -> str:
    """يزيل اللواحق التي يكتبها المستخدمون أحيانًا بالخطأ (…/chat/completions أو …/models)."""
    url = (url or "").strip().split("#", 1)[0].split("?", 1)[0].rstrip("/")
    for tail in ("/chat/completions", "/completions", "/messages", "/models", "/api/chat", "/api/tags", "/api/generate"):
        if url.lower().endswith(tail):
            url = url[: -len(tail)]
            if tail.startswith("/api/"):
                url += "/api"
            break
    return url.rstrip("/")


def _provider_of(host: str) -> Tuple[str, str]:
    for suffixes, pid, label in _KNOWN:
        if host_matches(host, *suffixes):
            return pid, label
    return "custom", ""


def _pick_dialect(proto: str, provider: str, host: str, path: str, port: Optional[int]) -> str:
    proto = (proto or "auto").lower()
    path_l = path.lower().rstrip("/")
    if provider == "anthropic":                                   # مضيف Anthropic لا يتكلم غير Messages
        return "anthropic"
    if proto in ("anthropic", "gemini", "ollama"):
        return proto
    if provider == "google":
        # الواجهة المتوافقة مع OpenAI تنتهي بـ /openai، وما عداها يعني Gemini الأصلي
        return "openai" if path_l.endswith("/openai") else "gemini"
    if provider == "ollama-cloud":
        return "ollama" if not path_l.startswith("/v1") else "openai"
    local_ollama = host in _LOOPBACK_NAMES or port == 11434
    if local_ollama and (path_l == "/api" or path_l.startswith("/api/") or (path_l == "" and port == 11434)):
        return "ollama"
    return "openai"


def resolve_endpoint(raw: dict) -> Endpoint:
    if not isinstance(raw, dict):
        raise EndpointError("نقطة الاتصال غير موجودة في الطلب")
    url = _clean_base(str(raw.get("url") or ""))
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise EndpointError("عنوان API غير صالح — يجب أن يبدأ بـ http:// أو https://")
    host = parsed.hostname.lower().rstrip(".")
    if host in _ALWAYS_BLOCKED_HOSTS:
        raise EndpointError("هذا العنوان غير مسموح به")
    port = parsed.port
    provider, label = _provider_of(host)
    path = parsed.path or ""
    # عناوين بلا إصدار: نكمّل /v1 للمزوّدين الذين يتطلبونه
    if path in ("", "/") and provider in ("openai", "anthropic"):
        url = url.rstrip("/") + "/v1"
        path = "/v1"
    kind = str(raw.get("kind") or "api").lower()
    dialect = _pick_dialect(str(raw.get("proto") or "auto"), provider, host, path, port)
    local = kind == "local" or _is_private_host(host)
    if not label:
        if dialect == "ollama" or port == 11434:
            label = "Ollama"
        elif port == 1234 and local:
            label = "LM Studio"                    # المنفذ الافتراضي لـ LM Studio — تلميح فقط
        else:
            label = "خادم محلي" if local else host
    return Endpoint(url=url, key=str(raw.get("key") or "").strip(), proto=str(raw.get("proto") or "auto"),
                    kind=kind, host=host, path=path, port=port, provider=provider, label=label,
                    dialect=dialect, local=local)
