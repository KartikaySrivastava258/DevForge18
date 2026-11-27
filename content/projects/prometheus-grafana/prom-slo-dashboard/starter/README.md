# Campus API SLOs

The campus API (job `campus-api`) exports `http_requests_total{code}` and the histogram
`http_request_duration_seconds` (`_bucket{le}`, `_count`). The team has agreed two service-level objectives
over a rolling 30 days:

| SLO | Target | Error budget |
|---|---|---|
| Availability | 99.5% of requests do not fail with 5xx | 0.5% (0.005) of requests |
| Latency | 99% of requests finish in 500 ms or less (the `le="0.5"` bucket) | 1% (0.01) of requests |

## Rules (`rules.yml`)

Recording rules, by `job`, for each window `5m`, `30m`, `1h`, `6h` and `30d`:

- `job:sli_availability_errors:ratio_rate<window>` — the share of requests that failed.
- `job:sli_latency_slow:ratio_rate<window>` — the share of requests slower than 500 ms.

And the budget left over 30 days (1 = untouched, 0 = spent):

- `job:slo_availability_budget_remaining:ratio30d`
- `job:slo_latency_budget_remaining:ratio30d`

Alerts — multiwindow, multi-burn-rate (burn rate = error ratio ÷ budget). Labels: `job` and `severity`:

| Alert | Fires when | Severity |
|---|---|---|
| `AvailabilityFastBurn`, `LatencyFastBurn` | burn rate above 14.4 over **both** 1 h and 5 m | `page` |
| `AvailabilitySlowBurn`, `LatencySlowBurn` | burn rate above 6 over **both** 6 h and 30 m | `ticket` |

`tests.yml` tests all four alerts with `promtool test rules`.

## Dashboard (`dashboard.json`)

Panels for the budget left (both SLOs), the burn rate (both SLOs) and at least one SLI — every query built on the
recording rules above, not on raw metrics.
