# Resource monitoring for the college's lab servers

Prometheus already scrapes node_exporter on every lab server (`job="node"`), so these metrics exist:
`node_cpu_seconds_total{mode=…}`, `node_memory_MemAvailable_bytes`, `node_memory_MemTotal_bytes`,
`node_filesystem_avail_bytes{mountpoint=…, fstype=…}` and `up`. The alerts the team wrote page the on-call
person for every CPU spike and warn about a disk only when it is already almost full. Fix that.

## What the rules must do (`rules.yml`)

Recording rules, per `instance`:

- `instance:node_cpu_utilisation:rate5m` — the busy fraction of the host's CPUs (0 to 1).
- `instance:node_memory_utilisation:ratio` — the used fraction of memory (0 to 1).

Alerts. Each alert's labels are `instance` (plus `mountpoint` for disks) and `severity` — aggregate away other
labels:

| Alert | Fires when | For | Severity |
|---|---|---|---|
| `HostHighCpu` | CPU utilisation above 90% | 10 minutes | warning |
| `HostMemoryPressure` | memory utilisation above 90% | 5 minutes | warning |
| `HostDiskWillFillIn4Hours` | at the last hour's rate, the filesystem will be full within 4 hours (ignore tmpfs and overlay) | 5 minutes | critical |
| `HostDown` | the host has not been scraped (`up == 0`) | 2 minutes | critical |

`tests.yml` must test every alert with `promtool test rules`, including at least one case where it must **not**
fire.

## Who is told (`alertmanager.yml`)

Critical alerts go to the `oncall-pager` receiver, warnings to `team-email`. When a host is down, its other
alerts are noise: add an inhibit rule so `HostDown` silences the other alerts of the same `instance`.
