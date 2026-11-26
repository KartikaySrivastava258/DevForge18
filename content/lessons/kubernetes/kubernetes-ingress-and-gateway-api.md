---
id: kubernetes-ingress-and-gateway-api
title: How traffic enters a cluster — LoadBalancer, Ingress and the Gateway API
track: kubernetes
order: 8
level: intermediate
estimated_minutes: 45
prerequisites: [kubernetes-deployments-and-self-healing]
learning_objectives:
  - Explain why a ClusterIP Service is not reachable from outside, and what a LoadBalancer Service adds.
  - Route HTTP traffic to two Services through one entry point, first with an Ingress and then with a Gateway and HTTPRoute.
  - Predict which HTTPRoute rule handles a request from the specification's precedence rules (path, then headers).
  - Explain why the Kubernetes project recommends the Gateway API over the frozen Ingress API.
resources:
  - title: Gateway API (Kubernetes documentation)
    url: https://kubernetes.io/docs/concepts/services-networking/gateway/
    publisher: Kubernetes
    type: documentation
    level: intermediate
    official: true
    why: The Gateway API is the successor to Ingress — an add-on, role-oriented, and implemented by a controller you install.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Ingress (Kubernetes documentation)
    url: https://kubernetes.io/docs/concepts/services-networking/ingress/
    publisher: Kubernetes
    type: documentation
    level: intermediate
    official: true
    why: The Kubernetes project recommends using Gateway instead of Ingress; the Ingress API is frozen — still generally available, with no plans to remove it, but no new features.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Gateway API — API overview (roles and resource model)
    url: https://gateway-api.sigs.k8s.io/docs/concepts/api-overview/
    publisher: Kubernetes SIG Network
    type: documentation
    level: intermediate
    official: true
    why: GatewayClass, Gateway and Routes, and the three roles — infrastructure provider, cluster operator, application developer.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: HTTPRoute match precedence (gateway-api source, apis/v1/httproute_types.go)
    url: https://github.com/kubernetes-sigs/gateway-api/blob/main/apis/v1/httproute_types.go
    publisher: Kubernetes SIG Network
    type: reference
    level: advanced
    official: true
    why: Matches are prioritised by exact path, then longest prefix, then method, then the largest number of header matches, then query parameters.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: cloud-provider-kind
    url: https://github.com/kubernetes-sigs/cloud-provider-kind
    publisher: Kubernetes SIG Testing (kind)
    type: source-code
    level: intermediate
    official: true
    why: LoadBalancer Services, Ingress and the Gateway API for kind clusters (Gateway and HTTPRoute pass the community conformance tests); runs as a container on the kind network.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: clusterip
    prompt: A Service has type ClusterIP. Can a browser on your laptop reach it?
    options:
      - { id: a, text: "Yes, at its cluster IP" }
      - { id: b, text: "No — a ClusterIP is only routable inside the cluster; outside traffic needs a LoadBalancer or NodePort Service, or an Ingress/Gateway in front of it" }
      - { id: c, text: "Only over HTTPS" }
    answer: b
    explanation: In the lab, only the LoadBalancer Service, the Ingress and the Gateway get an external address.
  - id: precedence
    prompt: An HTTPRoute has rules for path prefix /library, for prefix / with header x-campus north, and for prefix / alone. Which rule handles GET / with x-campus north?
    options:
      - { id: a, text: "The first rule in the list" }
      - { id: b, text: "The / rule with the header match: equal path prefixes, so the larger number of header matches wins" }
      - { id: c, text: "The plain / rule, because it matches everything" }
    answer: b
    explanation: The specification orders matches by exact path, longest prefix, method, then number of header matches. List order only breaks remaining ties.
  - id: why-gateway
    prompt: Why does the Kubernetes project recommend the Gateway API for new work?
    options:
      - { id: a, text: "Ingress has been removed" }
      - { id: b, text: "Ingress is frozen (no new features) and pushed advanced routing into controller-specific annotations; Gateway API has typed routing (headers, weights, rewrites), more protocols, and separate resources for the people who run the gateway and the people who write routes" }
      - { id: c, text: "Gateway is faster" }
    answer: b
    explanation: Ingress stays supported. The Gateway API's role split lets a platform team own the Gateway while application teams attach their own HTTPRoutes.
verification:
  method: executed
  details: Every command is run by the test suite on a kind cluster (Kubernetes 1.36.1, node image pinned by digest) with cloud-provider-kind v0.12.0 (image pinned by digest), after the first Kubernetes lesson, and its output is compared with this lesson. External addresses vary and are not printed. Behaviour was checked against the Kubernetes Ingress and Gateway pages, the Gateway API documentation and the HTTPRoute source on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Services give Pods a stable address *inside* the cluster; to let users in from outside you need a **LoadBalancer**, an **Ingress**, or — the recommended way today — a **Gateway** with **HTTPRoutes** that decide which Service gets each request.

## Explain it like I'm twelve

A school has many classrooms (Services). Visitors cannot wander the corridors; they arrive at the front gate (**Gateway**). The gate has rules on a board (**HTTPRoutes**): "parcels for the library → library; anyone with a north-campus badge → library; everyone else → the timetable office." The caretaker builds and runs the gate; each teacher writes their own line on the board.

Where the analogy breaks: the gate is a real proxy (here Envoy) that a controller configures from those rules within seconds.

## What problem it solves

Giving every Service its own public load balancer is expensive and hard to manage, and it cannot route by path or header. An entry point that understands HTTP lets one address serve many Services, terminate TLS in one place, and split traffic for canary releases. Ingress did this first; its routing features ended up in controller-specific annotations, so the Gateway API replaced it with typed, portable resources.

## How it works

![](media:kubernetes/traffic-entry.svg)

- **ClusterIP** (the default): reachable only inside the cluster. **LoadBalancer**: a cloud — or, in kind, cloud-provider-kind — gives the Service an external address.
- **Ingress** + an Ingress controller: host and path rules to Services. The API is frozen: supported, but no new features.
- **Gateway API**: a **GatewayClass** (which controller; set up by the infrastructure provider), a **Gateway** (an entry point with listeners; run by the cluster operator) and **HTTPRoutes** (rules attached to a Gateway; written by application developers).
- When several rules match, the most specific wins: exact path, then longest prefix, then method, then the most header matches.

## Try it yourself

> **Local lab** — continues on the kind cluster from *Deployments and self-healing* (`kind get clusters` should list `devforge`). cloud-provider-kind runs as a container on the `kind` Docker network and starts Envoy proxy containers for load balancers and gateways; it mounts the Docker socket to do that, which is acceptable on a learning machine but gives it full control of Docker — never do it with an image you do not trust. Every command is run automatically in DevForge's tests; the last step removes everything.

### 1. Start cloud-provider-kind

```bash run
docker run -d --name devforge-cpk --network kind -v /var/run/docker.sock:/var/run/docker.sock \
  registry.k8s.io/cloud-provider-kind/cloud-controller-manager:v0.12.0@sha256:1b97632e5dfec8f83c7e970cf18cedb9e6b707e272011d712cabf6ab59d323c9 > /dev/null
for i in $(seq 1 60); do kubectl get gatewayclass cloud-provider-kind > /dev/null 2>&1 && break; sleep 2; done
kubectl get gatewayclass -o custom-columns=NAME:.metadata.name,CONTROLLER:.spec.controllerName
kubectl get ingressclass -o custom-columns=NAME:.metadata.name,CONTROLLER:.spec.controller
```

```text output
NAME                  CONTROLLER
cloud-provider-kind   kind.sigs.k8s.io/gateway-controller
NAME                  CONTROLLER
cloud-provider-kind   kind.sigs.k8s.io/ingress-controller
```

It installed the Gateway API resource definitions and registered itself both as a GatewayClass and as an IngressClass.

### 2. Two Services, reachable only inside the cluster

```bash run
kubectl create namespace traffic-lab
n="-n traffic-lab"
for svc in timetable library; do
  kubectl $n create deployment "$svc" --image=busybox:1.37 -- sh -c \
    "mkdir -p /www/library && echo 'hello from the $svc service' | tee /www/index.html > /www/library/index.html && httpd -f -p 8080 -h /www" > /dev/null
  kubectl $n expose deployment "$svc" --port=80 --target-port=8080 > /dev/null
done
for svc in timetable library; do kubectl $n rollout status "deployment/$svc" --timeout=180s > /dev/null; done
kubectl $n get services -o custom-columns=NAME:.metadata.name,TYPE:.spec.type,EXTERNAL-ADDRESS:.status.loadBalancer.ingress[0].ip
```

```text output
namespace/traffic-lab created
NAME        TYPE        EXTERNAL-ADDRESS
library     ClusterIP   <none>
timetable   ClusterIP   <none>
```

Each Service has a cluster IP, but nothing outside the cluster can use it.

### 3. A LoadBalancer Service

```bash run
kubectl $n expose deployment timetable --name=timetable-lb --type=LoadBalancer --port=80 --target-port=8080 > /dev/null
for i in $(seq 1 60); do lb=$(kubectl $n get service timetable-lb -o jsonpath='{.status.loadBalancer.ingress[0].ip}'); [ -n "$lb" ] && break; sleep 2; done
for i in $(seq 1 30); do curl -s -m 2 "http://$lb/" > /dev/null && break; sleep 2; done
curl -s "http://$lb/"
```

```text output
hello from the timetable service
```

cloud-provider-kind played the cloud's part: it gave the Service an external address and started an Envoy proxy for it. In a cloud, each such Service usually means one paid load balancer — fine for one service, expensive for twenty.

### 4. An Ingress: one entry point, rules by path

```bash run
kubectl $n create ingress campus --rule="/library*=library:80" --rule="/*=timetable:80" > /dev/null
for i in $(seq 1 60); do ing=$(kubectl $n get ingress campus -o jsonpath='{.status.loadBalancer.ingress[0].ip}'); [ -n "$ing" ] && curl -s -m 2 "http://$ing/" > /dev/null && break; sleep 2; done
echo "/          -> $(curl -s "http://$ing/")"
echo "/library/  -> $(curl -s "http://$ing/library/")"
```

```text output
/          -> hello from the timetable service
/library/  -> hello from the library service
```

One address, two Services. Ingress handles host and path rules; anything more (headers, weights, rewrites) depends on each controller's annotations — which is why the API was frozen and replaced.

### 5. A Gateway and an HTTPRoute

```bash run
cat > gateway.yaml <<'EOF'
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway                     # the entry point (owned by the cluster operator)
metadata:
  name: campus
  namespace: traffic-lab
spec:
  gatewayClassName: cloud-provider-kind
  listeners:
    - name: http
      protocol: HTTP
      port: 80
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute                   # the routing rules (owned by application developers)
metadata:
  name: campus-routes
  namespace: traffic-lab
spec:
  parentRefs:
    - name: campus
  rules:
    - matches:
        - path: { type: PathPrefix, value: /library }
      backendRefs:
        - { name: library, port: 80 }
    - matches:
        - path: { type: PathPrefix, value: / }
          headers:
            - { name: x-campus, value: north }
      backendRefs:
        - { name: library, port: 80 }
    - matches:
        - path: { type: PathPrefix, value: / }
      backendRefs:
        - { name: timetable, port: 80 }
EOF
kubectl apply -f gateway.yaml
kubectl $n wait --for=condition=Programmed gateway/campus --timeout=180s
# The route's status is written separately, a moment later: wait for it rather than sampling once.
kubectl $n wait --for=jsonpath='{.status.parents[0].conditions[?(@.type=="ResolvedRefs")].status}'=True httproute/campus-routes --timeout=120s > /dev/null
kubectl $n get httproute campus-routes -o jsonpath='{range .status.parents[0].conditions[*]}{.type}={.status}{"\n"}{end}'
```

```text output
gateway.gateway.networking.k8s.io/campus created
httproute.gateway.networking.k8s.io/campus-routes created
gateway.gateway.networking.k8s.io/campus condition met
Accepted=True
ResolvedRefs=True
```

`Programmed` means the controller configured a proxy for the Gateway; `Accepted` and `ResolvedRefs` mean the route attached to it and both Services exist. Now send three requests:

```bash run
gw=$(kubectl $n get gateway campus -o jsonpath='{.status.addresses[0].value}')
for i in $(seq 1 30); do curl -s -m 2 "http://$gw/" > /dev/null && break; sleep 2; done
echo "GET /                      -> $(curl -s "http://$gw/")"
echo "GET /library/              -> $(curl -s "http://$gw/library/")"
echo "GET / with x-campus: north -> $(curl -s -H 'x-campus: north' "http://$gw/")"
```

```text output
GET /                      -> hello from the timetable service
GET /library/              -> hello from the library service
GET / with x-campus: north -> hello from the library service
```

- `/library/` matched the longer prefix, `/library`, before `/`.
- `/` with the header matched two rules with equal prefixes; the one with **more header matches** won — as the specification requires, whatever the order in the list.

### 6. Clean up

```bash run
kubectl delete namespace traffic-lab --wait=true > /dev/null
# cloud-provider-kind removes the proxy containers of deleted load balancers and gateways.
for i in $(seq 1 30); do [ -z "$(docker ps -aq --filter name=kindccm)" ] && break; sleep 2; done
echo "proxy containers left: $(docker ps -aq --filter name=kindccm | wc -l | tr -d ' ')"
docker rm -f devforge-cpk > /dev/null
kind delete cluster --name devforge
```

```text output
proxy containers left: 0
…
```

## Common mistakes

- **A LoadBalancer Service per microservice.** Costly and unmanageable; put one Gateway in front and route.
- **Choosing Ingress for new work.** It still works, but it is frozen; start with the Gateway API, and migrate Ingress resources with the official migration guide.
- **Forgetting to check route status.** A typo in `parentRefs` or a missing Service leaves the route not `Accepted` or not `ResolvedRefs`, and traffic simply never arrives.
- **Assuming rule order decides.** Specificity decides first (path, method, headers, query); order only breaks ties.
- **Mounting the Docker socket casually.** Tools like cloud-provider-kind need it by design; on shared or production machines it means full control of the host.

## Where this fits in a real system

Clouds implement Gateways with their own load balancers; teams also run Envoy Gateway, Istio or NGINX Gateway Fabric. **Terraform** usually creates the GatewayClass and Gateway, application teams ship HTTPRoutes with their **GitHub Actions** deployments, TLS is terminated at the Gateway (as **Nginx** does in its track), and **Prometheus** and **OpenTelemetry** measure what passes through it.
