"""هياكل مشتركة بين كل صيغ الاتصال (dialects)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, Iterator, List, Optional, Set, Tuple

from ..providers import Endpoint

_DATA_URL = re.compile(r"^data:([^;,]+)?(;base64)?,(.*)$", re.S)


@dataclass
class Msg:
    role: str                                   # user | assistant
    content: str = ""
    images: List[Tuple[str, str]] = field(default_factory=list)   # (mime, base64)


@dataclass
class ChatRequest:
    ep: Endpoint
    model: str
    system: str = ""
    messages: List[Msg] = field(default_factory=list)
    params: Dict[str, float] = field(default_factory=dict)
    thinking: str = "auto"                      # auto | on | off
    stream: bool = True
    num_ctx: Optional[int] = None


class Adjust:
    """يتتبع ما أُرسل فعلًا وما تقرّر حذفه بعد رفض المزوّد له."""

    def __init__(self) -> None:
        self.skip: Set[str] = set()
        self.used: Set[str] = set()
        self.token_key: Optional[str] = None

    def use(self, name: str) -> bool:
        """يُسجَّل الحقل كمستخدم ويعيد False إن كان محذوفًا."""
        if name in self.skip:
            return False
        self.used.add(name)
        return True


def split_data_url(data: str) -> Tuple[str, str]:
    """data:image/png;base64,XXXX → ('image/png', 'XXXX')."""
    m = _DATA_URL.match(data or "")
    if not m:
        return "image/png", (data or "").strip()
    return (m.group(1) or "image/png"), m.group(3)


def parse_messages(raw: list) -> List[Msg]:
    """يحوّل رسائل الواجهة إلى Msg، ويدمج الرسائل المتجاورة من الدور نفسه ويتخطى الفارغ."""
    out: List[Msg] = []
    for m in raw or []:
        if not isinstance(m, dict):
            continue
        role = "assistant" if m.get("role") == "assistant" else "user"
        content = m.get("content")
        content = content if isinstance(content, str) else ""
        imgs: List[Tuple[str, str]] = []
        for im in m.get("images") or []:
            if isinstance(im, dict) and isinstance(im.get("data"), str) and im["data"]:
                mime, b64 = split_data_url(im["data"])
                mime = im.get("mime") or mime
                if b64:
                    imgs.append((mime, b64))
        if not content.strip() and not imgs:
            continue
        if out and out[-1].role == role:
            prev = out[-1]
            prev.content = (prev.content + "\n\n" + content).strip() if content else prev.content
            prev.images.extend(imgs)
        else:
            out.append(Msg(role, content, imgs))
    return out


def user_first(msgs: List[Msg]) -> List[Msg]:
    """Anthropic وGemini يشترطان أن تبدأ المحادثة برسالة مستخدم."""
    i = 0
    while i < len(msgs) and msgs[i].role != "user":
        i += 1
    return msgs[i:]


def event(kind: str, **kw) -> dict:
    e = {"t": kind}
    e.update(kw)
    return e


class Dialect:
    name = "base"

    def chat_url(self, ep: Endpoint, model: str, stream: bool) -> str:
        raise NotImplementedError

    def headers(self, ep: Endpoint) -> Dict[str, str]:
        raise NotImplementedError

    def build(self, req: ChatRequest, adj: Adjust) -> dict:
        raise NotImplementedError

    def stream_events(self, lines: Iterator[str], req: ChatRequest) -> Iterator[dict]:
        raise NotImplementedError

    def once_events(self, data: dict, req: ChatRequest) -> Iterator[dict]:
        raise NotImplementedError


def sse_data(lines: Iterator[str]) -> Iterator[str]:
    """يستخرج حمولة data: من بث SSE (يتجاهل التعليقات وأسماء الأحداث)."""
    for line in lines:
        if line.startswith("data:"):
            yield line[5:].strip()
