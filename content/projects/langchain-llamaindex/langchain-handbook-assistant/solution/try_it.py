"""Try the assistant by hand: python try_it.py (inside the container — see README.md)."""
from assistant import answer, load_chunks
from stand_ins import scripted_model

chunks = load_chunks()
print(f"{len(chunks)} chunks")
for c in chunks[:3]:
    print(" ", c.metadata, len(c.page_content.split()), "words")

# The scripted model returns exactly this reply, whatever it is asked — you decide what "the model" says.
for question, reply in [
    ("What attendance do I need to sit the end-semester exam?", "At least 75 percent in each course [1]."),
    ("What attendance do I need to sit the end-semester exam?", "At least 75 percent [7]."),
    ("Who won the cricket world cup?", "(should never be used)"),
]:
    result = answer(question, scripted_model(reply))
    print(f"\n{question}\n  refused: {result['refused']}\n  answer: {result['answer']}\n  sources: {result['sources']}")
