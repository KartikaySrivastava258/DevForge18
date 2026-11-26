"""Figure for kubernetes-ingress-and-gateway-api; run: python3 scripts/figures/kubernetes/traffic-entry.py"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts" / "figures"))
from figlib import Fig, write  # noqa: E402

f = Fig(720, 290, "From outside to a Service, from How traffic enters a cluster.")
f.box(10, 110, 110, 60, "f-box"); f.text(65, 136, "client", "f-small f-strong"); f.text(65, 156, "outside", "f-small f-muted")
f.box(160, 20, 170, 66, "f-box-faint"); f.text(245, 44, "GatewayClass", "f-small f-strong f-mono"); f.text(245, 66, "infrastructure provider", "f-small", fit=160)
f.box(160, 106, 170, 70, "f-box-accent"); f.text(245, 130, "Gateway campus", "f-small f-strong f-mono", fit=160); f.text(245, 152, "listener :80", "f-small f-mono"); f.text(245, 168, "cluster operator", "f-small f-muted", fit=160)
f.box(370, 106, 170, 70, "f-box-warn"); f.text(455, 130, "HTTPRoute", "f-small f-strong f-mono"); f.text(455, 152, "path, headers", "f-small"); f.text(455, 168, "app developers", "f-small f-muted", fit=160)
f.box(580, 60, 130, 56, "f-box-ok"); f.text(645, 84, "library", "f-small f-strong f-mono"); f.text(645, 104, "/library or header", "f-small", fit=124)
f.box(580, 160, 130, 56, "f-box-ok"); f.text(645, 184, "timetable", "f-small f-strong f-mono"); f.text(645, 204, "everything else", "f-small", fit=124)
f.arrow([(122, 140), (158, 140)]); f.arrow([(245, 88), (245, 104)]); f.arrow([(332, 140), (368, 140)])
f.arrow([(542, 128), (578, 92)]); f.arrow([(542, 152), (578, 186)])
f.text(360, 238, "ClusterIP: inside only · LoadBalancer: one address per Service", "f-small f-muted", fit=640)
f.text(360, 262, "Ingress: frozen API, host and path rules · Gateway API: its successor", "f-small f-muted", fit=640)
write(ROOT, "kubernetes", "traffic-entry", f,
      "A client outside the cluster connects to the Gateway campus, which listens on port 80 and belongs to a GatewayClass set up by the infrastructure provider; the Gateway is run by the cluster operator. An HTTPRoute written by application developers matches on path and headers and sends /library and requests with the x-campus header to the library Service, and everything else to the timetable Service. ClusterIP Services are reachable only inside the cluster; a LoadBalancer Service gives one address per Service; Ingress is a frozen API with host and path rules; the Gateway API is its successor.",
      "One entry point, typed routing rules, and separate resources for the people who run the gateway and the people who write routes.")
