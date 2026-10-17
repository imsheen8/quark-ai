"""
قواعد المعاملات الخاصة بكل مزوّد/نموذج.

بعض النماذج ترفض معاملات معيّنة بخطأ 400 (مثل temperature في نماذج التفكير). هذه القواعد
تتجنّب أشهر الحالات مسبقًا، وما يفلت منها تعالجه طبقة «الإصلاح التلقائي» في service.py
التي تقرأ رسالة الخطأ وتعيد الطلب بدون الحقل المرفوض.
"""
from __future__ import annotations

import re
from typing import Optional

from .providers import Endpoint

_REASONING_OPENAI = re.compile(r"^(o\d+|gpt-5)([-._].*)?$")
_KIMI_FIXED = re.compile(r"^kimi-k2[._][56]([-_:].*)?$")
_THINKING_FAMILIES = re.compile(r"(qwen3|qwq|deepseek-r1|deepseek-reasoner|deepseek-v[34]|gpt-oss|magistral|gemma-?3n?|glm-4\.[5-9]|minimax-m|step-?3)")
_OPUS = re.compile(r"(?<![a-z])opus[-_]?(\d{1,2})(?!\d)(?:[-_.](\d{1,2})(?!\d))?")


def basename(model: str) -> str:
    return (model or "").lower().rsplit("/", 1)[-1].strip()


def fixed_sampling(ep: Endpoint, model: str) -> bool:
    """نماذج لا تقبل إلا قيمة temperature/top_p الافتراضية."""
    name = basename(model)
    if _REASONING_OPENAI.match(name) and ep.provider in ("openai", "azure", "openrouter", "custom"):
        return not name.startswith("gpt-5-chat")
    if ep.provider == "moonshot" and _KIMI_FIXED.match(name):
        return True
    return False


def anthropic_drops_sampling(model: str) -> bool:
    """بدءًا من Opus 4.7 أُزيلت معاملات العيّنة (temperature/top_p) من واجهة Anthropic."""
    m = _OPUS.search((model or "").lower())
    if not m:
        return False
    major = int(m.group(1))
    minor = int(m.group(2)) if m.group(2) else 0
    return (major, minor) >= (4, 7)


def token_param(ep: Endpoint, model: str) -> str:
    """اسم حقل الحد الأقصى للرموز في واجهة OpenAI."""
    if ep.provider in ("openai", "azure"):
        return "max_completion_tokens"
    if _REASONING_OPENAI.match(basename(model)) and ep.provider != "openrouter":
        return "max_completion_tokens"
    return "max_tokens"


def wants_usage_option(ep: Endpoint) -> bool:
    """هل نطلب usage داخل البث؟ نكتفي بالمزوّدين المعروفين وبالخوادم المحلية لأن غيرهم قد يرفض الحقل."""
    return ep.provider in ("openai", "azure", "deepseek", "xai", "mistral", "together", "fireworks", "moonshot") or ep.local


def looks_like_thinking_model(model: str) -> bool:
    return bool(_THINKING_FAMILIES.search((model or "").lower()))


def clamp(value, lo, hi) -> Optional[float]:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if v != v:       # NaN
        return None
    return max(lo, min(hi, v))
