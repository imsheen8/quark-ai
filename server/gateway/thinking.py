"""
فصل «التفكير» عن الإجابة عندما يضعه النموذج داخل وسوم نصية مثل <think>…</think>
(شائع في Qwen3 وDeepSeek-R1 وبعض الخوادم المحلية).

نعالج الكتلة الأولى فقط، أي التي تبدأ بها الإجابة، حتى لا نمسّ نصًّا يشرح هذه الوسوم داخل الرد.
"""
from __future__ import annotations

import re
from typing import List, Tuple

_TAGS = ("think", "thinking", "thought", "reasoning")
_OPEN = re.compile(r"<(%s)>" % "|".join(_TAGS))
_MAX_OPEN = max(len(t) for t in _TAGS) + 2


class ThinkSplitter:
    START, THINK, ANSWER = 0, 1, 2

    def __init__(self) -> None:
        self.state = self.START
        self.buf = ""
        self.close = ""
        self._trim = False

    def _emit_text(self, out: List[Tuple[str, str]], text: str) -> None:
        if self._trim:
            text = text.lstrip("\r\n")
            if not text:
                return
            self._trim = False
        if text:
            out.append(("text", text))

    def feed(self, chunk: str) -> List[Tuple[str, str]]:
        out: List[Tuple[str, str]] = []
        self.buf += chunk
        while True:
            if self.state == self.START:
                s = self.buf.lstrip()
                if not s:
                    break
                m = _OPEN.match(s)
                if m:
                    self.close = "</%s>" % m.group(1)
                    self.buf = s[m.end():]
                    self.state = self.THINK
                    continue
                if len(s) <= _MAX_OPEN and any(("<%s>" % t).startswith(s) for t in _TAGS):
                    break                      # قد تكتمل لاحقًا إلى وسم — ننتظر
                self.state = self.ANSWER
                continue
            if self.state == self.THINK:
                i = self.buf.find(self.close)
                if i >= 0:
                    if i:
                        out.append(("think", self.buf[:i]))
                    self.buf = self.buf[i + len(self.close):]
                    self.state = self.ANSWER
                    self._trim = True
                    continue
                keep = 0                       # نحتفظ بأي جزء من وسم الإغلاق في آخر النص
                for n in range(min(len(self.close) - 1, len(self.buf)), 0, -1):
                    if self.buf.endswith(self.close[:n]):
                        keep = n
                        break
                emit = self.buf[: len(self.buf) - keep]
                if emit:
                    out.append(("think", emit))
                self.buf = self.buf[len(self.buf) - keep:]
                break
            # ANSWER
            if self.buf:
                self._emit_text(out, self.buf)
                self.buf = ""
            break
        return out

    def flush(self) -> List[Tuple[str, str]]:
        out: List[Tuple[str, str]] = []
        if self.buf:
            kind = "think" if self.state == self.THINK else "text"
            if kind == "text":
                self._emit_text(out, self.buf)
            else:
                out.append((kind, self.buf))
        self.buf = ""
        return out
