# Airflow 3.4.0 with the MLflow client and the libraries the training task needs, all pinned.
FROM apache/airflow:slim-3.4.0-python3.12@sha256:2d3e42b9de0eca948b9a869817068fedcb8a8eac9827b1e6215de3329d59335f
RUN pip install --no-cache-dir "apache-airflow==3.4.0" "mlflow-skinny==3.18.0" "scikit-learn==1.9.1" \
    "pandas==3.1.0" "skops==0.16.0" --constraint /home/airflow/constraints.txt
