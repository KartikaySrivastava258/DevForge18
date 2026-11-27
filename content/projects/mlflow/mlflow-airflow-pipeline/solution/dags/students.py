"""Synthetic student data — invented, so no real student's information is used. Do not change this file:
the check regenerates the same data from it.

Each row is one student: weekly study hours, attendance (%), previous term's score, average sleep (hours) and
the final exam score (0-100) to predict. The score follows a made-up formula with noise, including diminishing
returns for very long study hours.
"""
import numpy as np
import pandas as pd

FEATURES = ["study_hours", "attendance", "previous_score", "sleep_hours"]
TARGET = "final_score"


def make_students(n=600, seed=42):
    rng = np.random.default_rng(seed)
    hours = rng.uniform(0, 20, n)
    attendance = rng.uniform(50, 100, n)
    previous = rng.normal(65, 12, n).clip(0, 100)
    sleep = rng.normal(7, 1, n).clip(4, 10)
    noise = rng.normal(0, 5, n)
    final = 20 + 1.8 * hours - 0.06 * hours**2 + 0.35 * attendance + 0.3 * previous + 1.5 * (sleep - 7) + noise
    return pd.DataFrame({"study_hours": hours, "attendance": attendance, "previous_score": previous,
                         "sleep_hours": sleep, TARGET: final.clip(0, 100)})
