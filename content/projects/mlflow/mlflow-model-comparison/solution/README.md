# Model comparison dashboard

The team has run many experiments in the MLflow experiment `student-performance` (from the beginner project).
The advisor wants one page that answers "which model is best, and by how much?", and the serving team wants the
best model registered so they can deploy it by name. Write `compare.py` (tracking URI from
`MLFLOW_TRACKING_URI`). It must:

1. Consider only runs of `student-performance` that **finished** (status `FINISHED`) and have the tag
   `dataset` = `synthetic-v1`. Runs among those without an `rmse` metric are listed as incomplete, not compared.
2. Write `comparison.md` in exactly this form:

   ```text
   # Model comparison: student-performance
   ## Best run per model
   | model | run | rmse | r2 |
   |---|---|---|---|
   | random_forest | forest-200 | 5.123 | 0.812 |
   | ridge | ridge-a1 | 5.601 | 0.776 |
   | baseline | baseline | 9.480 | -0.002 |
   ## Champion
   random_forest (forest-200), rmse 5.123 — 46.0% lower than the baseline
   ## Incomplete runs
   - tree-broken
   ```

   - one row per value of the parameter `model`: the run with the lowest `rmse` for that model, rows sorted by
     `rmse` (lowest first), numbers with three decimals, `run` is the run name;
   - the champion is the run with the lowest `rmse` overall, and the improvement is
     `(baseline rmse − champion rmse) ÷ baseline rmse` with one decimal. If no model beats the baseline, the line is
     `No model beats the baseline`;
   - `## Incomplete runs` lists run names alphabetically, or `- none`.
3. Register the champion's model (logged under the name `model`) as the registered model **`student-score`** and
   point the alias **`champion`** at that version. If `champion` already points to a version from the same run,
   register nothing new. With no champion, leave the registry unchanged.

The first attempt compares failed and unrelated runs too, and registers nothing.
