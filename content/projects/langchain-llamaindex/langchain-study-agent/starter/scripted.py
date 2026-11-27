"""TEACHING STAND-IN for a chat model, from "Tool calling and agents": GenericFakeChatModel replays scripted
replies, one per turn, so you can make "the model" do anything — including what a prompt-injected model would do.
"""
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage


def call(name, n=1, **args):
    """A model turn that asks for one tool call."""
    return AIMessage("", tool_calls=[{"name": name, "args": args, "id": f"call-{n}"}])


def calls(*requests):
    """A model turn that asks for several tool calls at once: calls(("search_notes", {"query": "exam"}), ...)."""
    return AIMessage("", tool_calls=[{"name": name, "args": args, "id": f"multi-{i}"} for i, (name, args) in enumerate(requests, 1)])


def model(*replies):
    """A stand-in model that replays the given replies, one per turn."""
    return GenericFakeChatModel(messages=iter(replies))
