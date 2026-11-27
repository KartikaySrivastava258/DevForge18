---
id: kubernetes-namespaces-labels-selectors
title: Namespaces, labels and selectors
track: kubernetes
order: 5
level: intermediate
estimated_minutes: 40
prerequisites: [kubernetes-deployments-and-self-healing]
learning_objectives:
  - Use namespaces to give teams their own space for names, and reach a Service in another namespace by its DNS name.
  - Select objects with equality-based and set-based label selectors.
  - Explain how Deployments and Services find their Pods through labels, and take a Pod out of service by relabelling it.
  - Limit a namespace with a ResourceQuota, and recognise a quota rejection.
resources:
  - title: Namespaces
    url: https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/
    publisher: Kubernetes
    type: documentation
    level: beginner
    official: true
    why: Names must be unique within a namespace, not across namespaces; a Service's DNS name is <service-name>.<namespace-name>.svc.cluster.local.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Labels and Selectors
    url: https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/
    publisher: Kubernetes
    type: documentation
    level: beginner
    official: true
    why: Equality-based and set-based selectors, and that comma-separated requirements must all match.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Resource Quotas
    url: https://kubernetes.io/docs/concepts/policy/resource-quotas/
    publisher: Kubernetes
    type: documentation
    level: intermediate
    official: true
    why: Object-count and compute quotas per namespace; a request that would exceed a quota is rejected with 403 Forbidden and a message naming the constraint.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: same-name
    prompt: Two teams each create a Deployment and a Service called web, in namespaces team-a and team-b. What happens?
    options:
      - { id: a, text: "The second one fails: the name is taken" }
      - { id: b, text: "Both work: names only have to be unique within a namespace. Pods in team-a reach their own web as web, and the other one as web.team-b.svc.cluster.local" }
      - { id: c, text: "Kubernetes merges them" }
    answer: b
    explanation: The lab creates both and calls each by name. Namespaces scope names and many policies; they are not, by themselves, a network or security boundary.
  - id: relabel
    prompt: You change one Pod's label from app=web to app=debug. The Deployment and Service both select app=web. What happens?
    options:
      - { id: a, text: "Nothing" }
      - { id: b, text: "The Pod leaves the Service (no more traffic) and the Deployment's ReplicaSet no longer counts it, so it creates a replacement; the relabelled Pod keeps running for you to inspect" }
      - { id: c, text: "The Pod is deleted" }
    answer: b
    explanation: Controllers and Services work entirely through label selectors. This is a standard way to take a misbehaving Pod out of rotation without losing its state.
  - id: quota
    prompt: A namespace has a quota of 3 Pods and already runs 3. Someone scales a Deployment to 5. What do they see?
    options:
      - { id: a, text: "kubectl scale fails" }
      - { id: b, text: "kubectl scale succeeds, but the ReplicaSet cannot create the extra Pods: the Deployment stays at 3 ready of 5, and FailedCreate events say \"exceeded quota\"" }
      - { id: c, text: "The oldest Pods are deleted to make room" }
    answer: b
    explanation: Scaling only changes the desired count; the Pods are created later by a controller, whose requests the quota rejects. Creating a Pod directly gets the 403 immediately.
verification:
  method: executed
  details: Every command is run by the test suite on a kind cluster (Kubernetes 1.36.1, node image pinned by digest), after the first Kubernetes lesson, and its output is compared with this lesson. Pod names contain random suffixes, shown as `…`. Behaviour was checked against the Kubernetes documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

**Namespaces** divide one cluster into named spaces so teams can use the same names without clashing, and **labels** with **selectors** are how everything in Kubernetes — Deployments, Services, `kubectl` and you — finds the objects it cares about.

## Explain it like I'm twelve

A school has several houses, and each house can have a pupil called Sam (**namespaces**: names only clash inside a house). Every pupil also wears badges — "year 7", "choir", "football" (**labels**). The choir teacher doesn't keep a list of names; she calls "everyone with a choir badge" (**selector**). Swap a pupil's badge and they silently leave the choir — and the teacher, counting badges, recruits someone new.

Where the analogy breaks: house names are also part of a pupil's "address" — `sam.house-b` — which is exactly how DNS names work across namespaces.

## What problem it solves

A cluster shared by several teams needs order: who owns what, which names are free, how much each team may use. And Kubernetes objects are not linked by fixed references — a Service does not list its Pods, because Pods come and go. Labels and selectors give a flexible, dynamic way to group things, and understanding them explains much of how Kubernetes behaves.

## How it works

![](media:kubernetes/labels-selectors.svg)

- A **namespace** scopes names (and many policies). `kubectl -n team-a …` works inside one; `-A` looks across all.
- A Service `web` in namespace `team-b` is reachable as `web` from inside `team-b`, and as `web.team-b.svc.cluster.local` from anywhere in the cluster.
- **Labels** are key–value pairs on any object. **Selectors** pick objects by labels: equality-based (`app=web`, `tier!=db`) or set-based (`tier in (frontend,api)`, `!canary`); comma means AND.
- A Deployment's ReplicaSet keeps *the number of Pods matching its selector* at the desired count; a Service sends traffic to *ready Pods matching its selector*.
- A **ResourceQuota** caps what a namespace may use — counts of objects, CPU, memory.

## Try it yourself

> **Local lab** — continues on the kind cluster from *Deployments and self-healing* (`kind get clusters` should list `devforge`). Every command is run automatically in DevForge's tests; the last step deletes the cluster.

### 1. Two teams, the same names

```bash run
kubectl create namespace team-a
kubectl create namespace team-b
for ns in team-a team-b; do
  kubectl -n "$ns" create deployment web --image=nginx:1.27-alpine --replicas=2 > /dev/null
  kubectl -n "$ns" expose deployment web --port=80 > /dev/null
done
for ns in team-a team-b; do kubectl -n "$ns" rollout status deployment/web --timeout=180s > /dev/null; done
kubectl get deployments -A -l app=web -o custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name,READY:.status.readyReplicas
```

```text output
namespace/team-a created
namespace/team-b created
NAMESPACE   NAME   READY
default     web    5
team-a      web    2
team-b      web    2
```

Three Deployments called `web` — including the one from the first lesson in the `default` namespace — and no clash. `-A` with `-l app=web` searched every namespace by label.

### 2. Reaching another namespace by DNS

```bash run
kubectl -n team-a exec deploy/web -- sh -c '
  wget -qO- -T 3 http://web > /dev/null && echo "web (same namespace): ok"
  wget -qO- -T 3 http://web.team-b.svc.cluster.local > /dev/null && echo "web.team-b.svc.cluster.local: ok"'
```

```text output
web (same namespace): ok
web.team-b.svc.cluster.local: ok
```

The short name `web` resolves inside the caller's own namespace; the full name reaches team B's Service. Namespaces separate names, not networks — by default every Pod can reach every other one (a later lesson adds network policies).

### 3. Labels and selectors

```bash run
kubectl -n team-a get pods -l app=web -o jsonpath='{range .items[*]}{.metadata.labels.app}{"\n"}{end}'
kubectl -n team-a label pods -l app=web tier=frontend > /dev/null
echo "app=web AND tier in (frontend,api): $(kubectl -n team-a get pods -l 'app=web,tier in (frontend,api)' --no-headers | wc -l | tr -d ' ') pods"
echo "app=web AND tier=db:                $(kubectl -n team-a get pods -l 'app=web,tier=db' --no-headers 2> /dev/null | wc -l | tr -d ' ') pods"
```

```text output
web
web
app=web AND tier in (frontend,api): 2 pods
app=web AND tier=db:                0 pods
```

`kubectl create deployment` labelled its Pods `app=web` (they also carry a `pod-template-hash` label that ties them to one ReplicaSet version). You added `tier=frontend` to both; the set-based selector found them, the equality one found none.

### 4. Take one Pod out of service

```bash run
pod=$(kubectl -n team-a get pods -l app=web -o jsonpath='{.items[0].metadata.name}')
kubectl -n team-a label pod "$pod" app=debug --overwrite > /dev/null
kubectl -n team-a wait --for=condition=Ready pod -l app=web --timeout=180s > /dev/null
sleep 2
echo "pods with app=web:   $(kubectl -n team-a get pods -l app=web --no-headers | wc -l | tr -d ' ')"
echo "pods with app=debug: $(kubectl -n team-a get pods -l app=debug --no-headers | wc -l | tr -d ' ')"
echo "relabelled pod still behind the Service: $(kubectl -n team-a get endpointslices -l kubernetes.io/service-name=web -o jsonpath='{range .items[*].endpoints[*]}{.targetRef.name}{"\n"}{end}' | grep -c "^$pod$" || true)"
```

```text output
pods with app=web:   2
pods with app=debug: 1
relabelled pod still behind the Service: 0
```

- The ReplicaSet counted only one `app=web` Pod, so it created a replacement: there are two again.
- The Service's endpoints (EndpointSlices) no longer include the relabelled Pod — it gets no traffic.
- The Pod itself is still running, with its memory and logs intact: you can inspect a misbehaving Pod without it serving users, and delete it when you are done.

### 5. A quota for team B

```bash run
cat > quota.yaml <<'EOF'
apiVersion: v1
kind: ResourceQuota
metadata:
  name: pod-limit
  namespace: team-b
spec:
  hard:
    pods: "3"
EOF
kubectl apply -f quota.yaml
kubectl -n team-b scale deployment web --replicas=5
for i in $(seq 1 60); do [ "$(kubectl -n team-b get deployment web -o jsonpath='{.status.readyReplicas}')" = 3 ] && break; sleep 2; done
for i in $(seq 1 30); do kubectl -n team-b get events --field-selector reason=FailedCreate --no-headers 2> /dev/null | grep . > /dev/null && break; sleep 1; done
kubectl -n team-b get deployment web -o jsonpath='ready {.status.readyReplicas} of {.spec.replicas}{"\n"}'
kubectl -n team-b get events --field-selector reason=FailedCreate -o jsonpath='{.items[0].message}{"\n"}'
```

```text output
resourcequota/pod-limit created
deployment.apps/web scaled
ready 3 of 5
Error creating: pods "web-…" is forbidden: exceeded quota: pod-limit, requested: pods=1, used: pods=3, limited: pods=3
```

`kubectl scale` succeeded — it only changed the desired count. The ReplicaSet then tried to create Pods and the quota refused two of them; the event explains why. Creating a Pod directly fails at once:

```bash run fails
kubectl -n team-b run extra --image=nginx:1.27-alpine
```

```text output
Error from server (Forbidden): pods "extra" is forbidden: exceeded quota: pod-limit, requested: pods=1, used: pods=3, limited: pods=3
```

### 6. Clean up

```bash run
kind delete cluster --name devforge
```

## Common mistakes

- **Forgetting `-n`.** Commands go to the `default` namespace (or your context's namespace). Check with `kubectl config view --minify | grep namespace`.
- **Treating namespaces as security boundaries.** They scope names and policies; isolation needs RBAC and network policies on top.
- **Changing a Deployment's selector.** It is immutable; a different selector means a new Deployment.
- **Overlapping selectors.** Two controllers whose selectors match the same Pods fight over them. Keep a unique label (such as `app`) per workload.
- **Quotas without defaults.** A CPU or memory quota rejects Pods that declare no requests; add a LimitRange to give them defaults.

## Where this fits in a real system

Teams usually get one namespace per application and environment, created with quotas and RBAC by **Terraform** or a platform pipeline. Labels such as `app`, `team` and `version` are what **Prometheus** uses to group metrics, what log tools filter on, and what **Kubernetes** network policies select — the same labels, used everywhere.
