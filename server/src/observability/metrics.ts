/**
 * Prometheus text-format metrics without external dependencies.
 *
 * Teaching note: the `route` label is the route *pattern* (/api/tracks/:slug),
 * never the raw URL. Putting raw URLs or user IDs into labels creates
 * unbounded label cardinality — a classic way to overload Prometheus.
 */
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

interface Histogram {
  counts: number[];
  sum: number;
  count: number;
}

function labelString(labels: Record<string, string>): string {
  const parts = Object.entries(labels).map(
    ([k, v]) => `${k}="${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`,
  );
  return parts.length ? `{${parts.join(",")}}` : "";
}

export class Metrics {
  private readonly requests = new Map<string, { labels: Record<string, string>; value: number }>();
  private readonly durations = new Map<string, { labels: Record<string, string>; hist: Histogram }>();
  private readonly startedAt = Date.now();

  observeRequest(method: string, route: string, status: number, seconds: number): void {
    const reqLabels = { method, route, status: String(status) };
    const reqKey = labelString(reqLabels);
    const entry = this.requests.get(reqKey);
    if (entry) entry.value += 1;
    else this.requests.set(reqKey, { labels: reqLabels, value: 1 });

    const durLabels = { method, route };
    const durKey = labelString(durLabels);
    let dur = this.durations.get(durKey);
    if (!dur) {
      dur = { labels: durLabels, hist: { counts: BUCKETS.map(() => 0), sum: 0, count: 0 } };
      this.durations.set(durKey, dur);
    }
    const hist = dur.hist;
    BUCKETS.forEach((bound, i) => {
      if (seconds <= bound) hist.counts[i] = (hist.counts[i] ?? 0) + 1;
    });
    hist.sum += seconds;
    hist.count += 1;
  }

  render(): string {
    const lines: string[] = [];
    lines.push("# HELP devforge_http_requests_total HTTP requests handled, by route pattern and status.");
    lines.push("# TYPE devforge_http_requests_total counter");
    for (const { labels, value } of this.requests.values()) {
      lines.push(`devforge_http_requests_total${labelString(labels)} ${value}`);
    }
    lines.push("# HELP devforge_http_request_duration_seconds HTTP request latency.");
    lines.push("# TYPE devforge_http_request_duration_seconds histogram");
    for (const { labels, hist } of this.durations.values()) {
      BUCKETS.forEach((bound, i) => {
        lines.push(`devforge_http_request_duration_seconds_bucket${labelString({ ...labels, le: String(bound) })} ${hist.counts[i] ?? 0}`);
      });
      lines.push(`devforge_http_request_duration_seconds_bucket${labelString({ ...labels, le: "+Inf" })} ${hist.count}`);
      lines.push(`devforge_http_request_duration_seconds_sum${labelString(labels)} ${hist.sum}`);
      lines.push(`devforge_http_request_duration_seconds_count${labelString(labels)} ${hist.count}`);
    }
    const mem = process.memoryUsage();
    lines.push("# HELP devforge_process_resident_memory_bytes Resident set size of the server process.");
    lines.push("# TYPE devforge_process_resident_memory_bytes gauge");
    lines.push(`devforge_process_resident_memory_bytes ${mem.rss}`);
    lines.push("# HELP devforge_process_uptime_seconds Seconds since the server started.");
    lines.push("# TYPE devforge_process_uptime_seconds gauge");
    lines.push(`devforge_process_uptime_seconds ${Math.round((Date.now() - this.startedAt) / 1000)}`);
    return `${lines.join("\n")}\n`;
  }
}
