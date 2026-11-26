# Prometheus and Grafana — research notes

Checked 2026-11-26 (UTC). Reuse these in lessons; add to them instead of researching again.

## Versions

| Tool | Version | Notes |
|---|---|---|
| Prometheus (+ promtool) | 3.16.0 | pinned in CI since milestone 4; sha256sums.txt from the release |
| Grafana OSS | 13.3.2 | pinned in CI; `.sha256` file next to the tarball on dl.grafana.com |
| Alertmanager (+ amtool) | v0.34.2 (2026-10-29) | v0.35.0 (2026-11-09) and v0.35.1 (2026-11-24) are newer than two weeks |

## Facts confirmed (source → wording)

- Metric types (prometheus.io/docs/concepts/metric_types/): a counter is "a single monotonically increasing counter whose value can only increase or be reset to zero on restart"; "Do not use a counter to expose a value that can decrease"; a gauge "can arbitrarily go up and down"; a classic histogram exposes cumulative `<basename>_bucket{le="…"}` counters, `_sum` and `_count`.
- Naming (…/practices/naming/): one unit per metric, base units (seconds, bytes), unit suffix in plural; accumulating counts end in `_total`.
- Histograms and summaries (…/practices/histograms/): summary quantiles are calculated in the instrumented program and "you cannot aggregate quantiles" across instances; histograms can be aggregated and quantiles computed later with `histogram_quantile`.
- Instrumentation (…/practices/instrumentation/): "Each labelset is an additional time series that has RAM, CPU, disk, and network costs"; "try to keep the cardinality of your metrics below 10"; "The vast majority of your metrics should have no labels".
- Rule unit tests (…/configuration/unit_testing_rules/): `promtool test rules test.yml` with `rule_files`, `evaluation_interval`, `tests` with `input_series`, `alert_rule_test` and `promql_expr_test`.
- Alertmanager (…/alerting/latest/alertmanager/): grouping (one notification for similar alerts), inhibition (suppress some alerts while others fire), silences (mute by matchers for a time).
- Alertmanager configuration (…/alerting/latest/configuration/): routing tree with `receiver`, `group_by`, `group_wait`, `group_interval`, `repeat_interval` inherited by child routes; `webhook_configs`.
- SRE workbook, alerting on SLOs (sre.google/workbook/alerting-on-slos/): burn rate is "how fast, relative to the SLO, the service consumes the error budget"; recommended multiwindow alerts: 2% of budget in 1 hour → burn rate 14.4 (page), 5% in 6 hours → 6 (page), 10% in 3 days → 1 (ticket); example `ratio_rate1h > (14.4*0.001)` for a 99.9% SLO.
- Grafana variables (grafana.com/docs/grafana/latest/dashboards/variables/): query variables; values are synced to the URL as `var-<name>=value`.
- Grafana provisioning (…/administration/provisioning/): dashboard providers with `path`, `foldersFromFilesStructure`, `allowUiUpdates`, `updateIntervalSeconds`.
