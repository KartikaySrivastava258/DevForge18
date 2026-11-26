"""Figure for prometheus-alerting-and-alertmanager; run: python3 scripts/figures/prometheus-grafana/alertmanager.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 290, "From rule to notification, from Alerting rules and Alertmanager.")
f.box(10, 80, 170, 110, "f-box"); f.text(95, 104, "Prometheus", "f-small f-strong"); f.text(95, 128, "alerting rules:", "f-small"); f.text(95, 148, "what is wrong", "f-small"); f.text(95, 170, "(expr, for, labels)", "f-small f-mono", fit=160)
f.box(230, 30, 250, 220, "f-box-accent"); f.text(355, 54, "Alertmanager", "f-small f-strong"); f.text(355, 82, "route by labels", "f-small"); f.text(355, 106, "group, wait, repeat", "f-small"); f.text(355, 134, "inhibit: ServiceDown", "f-small", fit=240); f.text(355, 154, "mutes HighLatency", "f-small", fit=240); f.text(355, 182, "silence: planned work", "f-small", fit=240); f.text(355, 222, "who hears, when, how often", "f-small f-muted", fit=240)
f.box(530, 20, 180, 60, "f-box-danger"); f.text(620, 44, "on-call", "f-small f-strong f-mono"); f.text(620, 64, "severity=page", "f-small f-mono")
f.box(530, 110, 180, 60, "f-box"); f.text(620, 134, "team-tickets", "f-small f-strong f-mono"); f.text(620, 154, "default route", "f-small")
f.box(530, 200, 180, 60, "f-box-ok"); f.text(620, 224, "heartbeat", "f-small f-strong f-mono"); f.text(620, 244, "Watchdog, always firing", "f-small", fit=170)
f.arrow([(182, 135), (228, 135)]); f.arrow([(482, 80), (528, 52)]); f.arrow([(482, 140), (528, 140)]); f.arrow([(482, 200), (528, 228)])
write(ROOT, "prometheus-grafana", "alertmanager", f,
      "Prometheus alerting rules decide what is wrong, with expr, for and labels, and send firing alerts to Alertmanager. Alertmanager routes by labels, groups, waits and repeats, inhibits HighLatency while ServiceDown fires, and applies silences for planned work: it decides who hears, when and how often. Alerts with severity=page go to on-call, others to team-tickets by default, and the always-firing Watchdog goes to a heartbeat receiver.",
      "Rules say what is wrong; Alertmanager decides who hears about it.")
