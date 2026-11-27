"""Numbered figure for the Git track quiz (diagram labelling); run: python3 scripts/figures/git-github/quiz-three-areas.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 220, "Numbered diagram for the Git track quiz: label the three places a change passes through.")
for n, x in enumerate([20, 270, 520], 1):
    f.box(x, 60, 180, 90, "f-box-faint"); f.text(x + 90, 112, str(n), "f-strong")
f.arrow([(202, 105), (268, 105)]); f.text(235, 92, "git add", "f-small f-mono")
f.arrow([(452, 105), (518, 105)]); f.text(485, 92, "git commit", "f-small f-mono")
f.text(360, 190, "label boxes 1, 2 and 3", "f-small", fit=600)
write(ROOT, "git-github", "quiz-three-areas", f,
      "Three numbered boxes from left to right: box 1, then an arrow labelled git add to box 2, then an arrow labelled git commit to box 3. The boxes are not named; the quiz asks which place each number stands for.",
      "Which place is each numbered box?")
