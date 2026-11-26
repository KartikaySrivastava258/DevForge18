"""Figure for jenkins-agents-and-labels; run: python3 scripts/figures/jenkins/agents.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 270, "Controller, queue and agents, from Agents, labels and running builds in containers.")
f.box(10, 60, 220, 150, "f-box-accent"); f.text(120, 84, "controller", "f-small f-strong"); f.text(120, 108, "built-in node:", "f-small"); f.text(120, 128, "0 executors", "f-small f-mono"); f.text(120, 156, "queue", "f-small f-strong"); f.text(120, 178, "needs-windows: no nodes", "f-small f-warn", fit=210); f.text(120, 196, "with the label 'windows'", "f-small f-warn", fit=210)
f.box(300, 50, 200, 100, "f-box-ok"); f.text(400, 74, "agent-1 (container)", "f-small f-strong", fit=190); f.text(400, 98, "label: linux", "f-small f-mono"); f.text(400, 120, "1 executor", "f-small"); f.text(400, 140, "runs on-agent #1", "f-small f-mono")
f.box(300, 175, 200, 70, "f-box-faint"); f.text(400, 199, "no agent labelled", "f-small"); f.text(400, 221, "windows", "f-small f-mono")
f.box(540, 50, 170, 100, "f-box"); f.text(625, 74, "connects in:", "f-small f-strong"); f.text(625, 98, "WebSocket on :8080", "f-small f-mono", fit=160); f.text(625, 120, "with its secret", "f-small")
f.arrow([(298, 100), (232, 100)]); f.text(265, 92, "", "f-small")
f.arrow([(538, 100), (502, 100)])
f.text(360, 262, "labels route stages; disposable container or Kubernetes agents keep builds clean", "f-small f-muted", fit=700)
write(ROOT, "jenkins", "agents", f,
      "The controller's built-in node has 0 executors, so it only schedules. Its queue holds the needs-windows build, waiting because there are no nodes with the label windows. agent-1, a container with the label linux and 1 executor, runs on-agent build 1. It connects in to the controller over WebSocket on port 8080 with its secret. Labels route stages to agents; disposable container or Kubernetes agents keep builds clean.",
      "The controller schedules; labelled agents build; the queue says why work waits.")
