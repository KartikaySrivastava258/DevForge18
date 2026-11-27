"""TEACHING STAND-INS — not real models. Do not change this file; the check uses it as it is.

* KeywordEmbedding is the hand-made embedding from "Embeddings and similarity": one number per topic, counting
  the topic's words, plus a constant 0.1 so that no text gets an all-zero vector (see the prompt-injection
  lesson). A real application uses a trained embedding model instead; only this class would change.
* scripted_model() is LangChain's FakeListChatModel: it replies with the texts you give it, in order. It stands
  where a real chat model (langchain-openai, langchain-anthropic, …) would be, so nothing here needs an API key
  or costs money, and every run gives the same output.
"""
import re

from langchain_core.embeddings import Embeddings
from langchain_core.language_models.fake_chat_models import FakeListChatModel

TOPICS = {
    "attendance": ["attendance", "attend", "absence", "absent", "classes"],
    "medical": ["medical", "illness", "ill", "sick", "doctor", "certificate"],
    "condonation": ["condonation", "condoned", "condone", "shortage", "committee"],
    "hall tickets": ["hall", "ticket", "tickets", "admitted", "identity"],
    "grading": ["grade", "grades", "graded", "sgpa", "cgpa", "point", "points"],
    "re-evaluation": ["evaluation", "evaluated", "revaluation", "marks", "script", "examiner"],
    "malpractice": ["malpractice", "phone", "phones", "watch", "device", "copying", "cheating"],
    "borrowing": ["borrow", "borrowed", "books", "loan", "renew", "renewed", "reserved"],
    "fines": ["fine", "fined", "fines", "late", "overdue", "lost", "loses", "lose"],
    "hostel": ["hostel", "curfew", "warden", "gates", "night"],
    "visitors": ["guest", "guests", "visitor", "visitors", "visit", "overnight", "lounge"],
    "fees": ["fee", "fees", "tuition", "instalment", "instalments", "pay", "payment", "deadline"],
    "refunds": ["refund", "refunds", "refunded", "withdraw", "withdrawal", "withdraws", "deposit"],
}


def vector(text):
    words = re.findall(r"[a-z]+", text.lower())
    return [float(sum(words.count(w) for w in keywords)) for keywords in TOPICS.values()] + [0.1]


class KeywordEmbedding(Embeddings):
    """Teaching stand-in for an embedding model."""

    def embed_documents(self, texts):
        return [vector(t) for t in texts]

    def embed_query(self, text):
        return vector(text)


def scripted_model(*replies):
    """Teaching stand-in for a chat model: returns the given replies, one per call."""
    return FakeListChatModel(responses=list(replies))
