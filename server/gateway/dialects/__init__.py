from .anthropic_messages import AnthropicMessages
from .base import Adjust, ChatRequest, Dialect, Msg, parse_messages
from .gemini_native import GeminiNative
from .ollama_native import OllamaNative
from .openai_chat import OpenAIChat

REGISTRY = {d.name: d for d in (OpenAIChat(), AnthropicMessages(), GeminiNative(), OllamaNative())}

__all__ = ["REGISTRY", "Adjust", "ChatRequest", "Dialect", "Msg", "parse_messages"]
