---
id: mlflow-choose-and-promote-a-champion
title: Choose a champion within a latency budget
track: mlflow
level: intermediate
mode: simulation
estimated_minutes: 25
prerequisites: [mlflow-comparing-runs, mlflow-models-and-registry]
objectives:
  - Sort and filter runs to find the best one by a metric, and the best one within a constraint.
  - Register runs as model versions and move the champion alias between them.
  - Explain a choice as a trade-off between error and latency, not as "the lowest number wins".
checkpoints:
  - { id: predicted, text: "I wrote down a prediction before each experiment and compared it with the event log" }
  - { id: challenges, text: "The three challenges below show Done" }
simulation:
  id: mlflow-experiment-explorer
  challenges: [lowest-error, within-budget, roll-back]
resources:
  - title: MLflow Tracking
    url: https://mlflow.org/docs/latest/ml/tracking/
    publisher: MLflow Project (LF Projects)
    type: documentation
    level: beginner
    official: true
    why: Searching runs, ordering them by a metric, and comparing them in the web interface.
    verification: { status: verified, checked_on: 2026-11-25 }
  - title: MLflow Model Registry
    url: https://mlflow.org/docs/latest/ml/model-registry/
    publisher: MLflow Project (LF Projects)
    type: documentation
    level: beginner
    official: true
    why: Registered models, versions and aliases, and the models:/<name>@<alias> URI.
    verification: { status: verified, checked_on: 2026-11-25 }
verification:
  method: docs-checked
  details: The simulation is a labelled teaching model, not a real MLflow, and its runs and numbers are invented to show a trade-off. Its registry rules — versions are numbered in order and never change, and an alias is a movable name for exactly one version — follow MLflow's Model Registry, as stated in the model. Challenges are verified on the server by replaying your actions through the same model.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## Goal

Use the experiment explorer like a scientist: **predict** which run should become the champion and what that choice costs, **run** the experiment, and **compare** with the plot and the event log. You finish when the server has verified all three challenges.

This lab runs in your browser. It is a model of an MLflow experiment and its Model Registry, not a real MLflow, and its numbers were not measured. The lessons *Comparing and searching runs* and *Models, signatures and the registry* show the same steps on a real MLflow tracking server.

## Steps

### 1. The most accurate model

Choose the scenario **Choose a champion**. There are ten runs of three kinds of model, and nothing is registered yet. Before you touch anything, look at the plot of RMSE against latency and write down:

- Which kind of model sits lowest on the plot? Is it also the slowest?
- Which run do you expect at the top when you sort by RMSE?

Use **Sort by** to check your answer. Then **Register** the run you chose, and use **Make champion** on its new version. Read the event log: which version number did the registry give it?

Lowest RMSE is one way to choose. Keep an eye on the latency column; it matters in the next step.

### 2. The best model that is fast enough

Choose **A 5 ms latency budget**. The service that will load the champion must answer within 5 ms. The plot now shows the budget as a dashed line, and slow runs are marked in the table.

- Which runs are inside the budget? Which of them has the lowest RMSE?
- How much RMSE do you expect to give up compared with the run from step 1?

Use **Max latency** to narrow the table, then sort. Does the filter change the runs themselves, or only what you see?

To measure the trade-off, register more than one candidate and move the champion between them. The event log compares the new champion with the old one, and warns if the champion is over the budget. Finish with the champion on the best run that fits.

### 3. Roll back a slow promotion

Choose **A champion that is too slow**. Three versions are registered, and version 3, the most accurate, was promoted. The service must answer within 5 ms.

- Read the registered versions. Which of them fit the budget, and which of those is the most accurate?
- Do you need to register a new version or retrain anything? Why not?

Move the alias and read the event log. Notice that the version numbers did not change.

The serving code loads the model through the alias, so moving it is the whole fix. The older versions are still there to fall back to.

## Simulation

```simulation mlflow-experiment-explorer
```

## Reset

Each scenario has a **Reset** button that restores its starting state. Your verified challenges stay recorded.

## What you practised

Runs are evidence for a decision, and sorting and filtering show the trade-offs between them. Choosing a model means stating the constraint, such as a latency budget, and the error you accept to meet it. The registry keeps every version, so promoting or rolling back is a matter of moving an alias.
