"""TEACHING STAND-IN — not a real model. Do not change this file; the check uses it as it is.

KeywordEmbedding is the hand-made embedding from "Embeddings and similarity": one number per research topic,
counting the topic's words, plus a constant 0.1 so that no text gets an all-zero vector (see the
prompt-injection lesson). It knows only the words below, so it is easy to fool — which is exactly why you
measure retrieval with an evaluation set instead of trusting a few examples. A real application would use a
trained embedding model; only this class would change.
"""
import re

from langchain_core.embeddings import Embeddings

TOPICS = {
    "images": ["image", "images", "photograph", "photographs", "camera", "video", "convolutional", "classifier", "detector", "frames"],
    "farming": ["farm", "farms", "farmer", "farmers", "crop", "crops", "rice", "cotton", "pest", "pests", "weed", "weeds", "leaf", "plots"],
    "health": ["hospital", "hospitals", "patient", "patients", "medical", "x", "ray", "radiologists", "disease", "diseases"],
    "speech": ["speech", "audio", "acoustic", "spoken", "recordings", "voice"],
    "language": ["language", "languages", "text", "words", "sign", "transcripts"],
    "energy": ["energy", "solar", "battery", "batteries", "charging", "electric", "power"],
    "forecasting": ["forecast", "forecasts", "forecasting", "predict", "prediction", "ahead"],
    "traffic": ["traffic", "road", "roads", "junction", "junctions", "vehicles"],
    "graphs": ["graph", "graphs", "nodes", "edges"],
    "privacy": ["privacy", "private", "federated", "sharing", "anonymous"],
    "security": ["phishing", "passwords", "attack", "attacks", "malware", "security"],
    "education": ["student", "students", "course", "courses", "learning", "mentors", "classroom", "teacher", "handbook", "handbooks"],
    "retrieval": ["retrieval", "retrieved", "retrieves", "passages", "citations", "chunks", "question", "questions"],
    "evaluation": ["evaluate", "evaluated", "evaluation", "hallucination", "hallucinations", "accuracy", "benchmark"],
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
