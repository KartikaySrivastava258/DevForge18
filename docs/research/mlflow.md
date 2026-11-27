# MLflow — research notes

Checked 2026-11-27 (UTC). Reuse these in lessons; add to them instead of researching again.

## Versions

| Component | Version | Notes |
|---|---|---|
| `ghcr.io/mlflow/mlflow` | v3.18.0 `@sha256:257204c7…` | Python 3.11.18; includes scikit-learn 1.9.1, numpy 2.4.6, pandas 3.1.0, scipy 1.17.1, skops 0.16.0; **no PostgreSQL driver** |
| psycopg[binary] | 3.3.7 (2026-11-03) | MLflow 3.18 uses psycopg 3 for `postgresql://` URIs (psycopg2 is not enough) |
| mlflow-skinny | 3.18.0 (2026-11-03) | client for the Airflow image |
| scikit-learn / pandas / skops | 1.9.1 (2026-09-10) / 3.1.0 (2026-10-22) / 0.16.0 (2026-09-24) | as in the MLflow image; pandas 3.1.0 is also in Airflow 3.4.0's constraints |

## Facts confirmed (source → wording)

- Backend store (mlflow.org/docs/latest/self-hosting/architecture/backend-store/): SQLite is the default; without `--backend-store-uri` MLflow uses `sqlite:///mlflow.db` in the current directory; "Always run mlflow db upgrade [db_uri] to upgrade your database schema before starting the server".
- Tracking server architecture (…/self-hosting/architecture/tracking-server/): proxied artifacts via `--artifacts-destination`; direct access with `--no-serve-artifacts --default-artifact-root s3://…`.
- `mlflow server --help` (3.18.0): `--serve-artifacts` default; artifacts default to `./mlartifacts`; `--allowed-hosts`, `--expose-prometheus`, `--registry-store-uri`.
- mlflow.sklearn API: `serialization_format` can be pickle, cloudpickle or skops; `registered_model_name` registers each logged model as a new version.
- Local serving (…/ml/deployment/deploy-model-locally/): endpoints /invocations, /ping, /health (same as /ping), /version; JSON inputs dataframe_split, dataframe_records, instances, inputs.
- Signatures (…/ml/model/signatures/): inputs are validated against the signature when loading as pyfunc, with deployment tools, and when serving via the REST API.
- Model registry (…/ml/model-registry/): aliases such as @champion for deployment workflows.

## Observed while building lessons

- Default server in the official image (working directory `/`) creates `/mlflow.db` and `/mlartifacts`; replacing the container loses all runs.
- Security middleware: only localhost is accepted by default; `--allowed-hosts` replaces that list, so in-container clients using `127.0.0.1:5000` must be listed too (otherwise HTTP 403 "invalid Host header").
- `runs/search` responses are pretty-printed JSON — parse with Python, not grep.
- `mlflow.sklearn.log_model` in the Airflow image failed first with "No module named 'pandas'", then "No module named 'skops'".
- The scoring server resolves `models:/name@alias` at start-up; moving the alias has no effect until the container restarts.
- Signature enforcement for a request with 2 of 10 columns: HTTP 400, `INVALID_PARAMETER_VALUE`, message lists the expected columns.
- PSI on 111 held-out rows vs the training split (10 decile bins) is 0.18 — sampling noise alone; +0.03 on bmi gives 0.37.
- Reproducibility: the same Airflow run cleared and re-run gave identical RMSE 53.8471 and identical data/code hashes; alpha 1.0 gave 55.7267.
