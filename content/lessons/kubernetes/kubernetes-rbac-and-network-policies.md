---
id: kubernetes-rbac-and-network-policies
title: RBAC and network policies
track: kubernetes
order: 7
level: advanced
estimated_minutes: 45
prerequisites: [kubernetes-deployments-and-self-healing]
learning_objectives:
  - Give a workload's ServiceAccount exactly the API permissions it needs with a Role and RoleBinding.
  - Check permissions before and after with kubectl auth can-i, and read a Forbidden error.
  - Show that Pods accept traffic from every other Pod by default, and restrict it with a NetworkPolicy.
  - Explain why both layers are needed — who may call the Kubernetes API, and who may connect to whom.
resources:
  - title: Using RBAC Authorization
    url: https://kubernetes.io/docs/reference/access-authn-authz/rbac/
    publisher: Kubernetes
    type: documentation
    level: advanced
    official: true
    why: Roles, ClusterRoles and bindings; permissions are purely additive (no deny rules); service account usernames are system:serviceaccount:<namespace>:<name>.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Network Policies
    url: https://kubernetes.io/docs/concepts/services-networking/network-policies/
    publisher: Kubernetes
    type: documentation
    level: advanced
    official: true
    why: Pods are non-isolated by default; a policy that selects a Pod with Ingress in policyTypes isolates it, and only listed traffic is allowed; a network plugin must enforce policies.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: kind v0.24.0 release notes (network policy support)
    url: https://github.com/kubernetes-sigs/kind/releases/tag/v0.24.0
    publisher: Kubernetes SIG Testing (kind)
    type: reference
    level: advanced
    official: true
    why: kind enforces NetworkPolicy out of the box (via kube-network-policies) from this release, so the lab's policy really blocks traffic.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: additive
    prompt: A RoleBinding grants a ServiceAccount the pod-reader Role. How do you stop it from reading pods in one specific namespace?
    options:
      - { id: a, text: "Add a deny rule for that namespace" }
      - { id: b, text: "RBAC has no deny rules: grant only what is needed, where it is needed — a Role and RoleBinding in each namespace that needs it, not a cluster-wide binding" }
      - { id: c, text: "Delete the ServiceAccount's token" }
    answer: b
    explanation: Permissions only add up. A Role is namespaced, so binding it in one namespace grants nothing elsewhere — the lab's can-i check for the default namespace says no.
  - id: default-network
    prompt: Two Pods in a namespace with no NetworkPolicies. Can one connect to the other?
    options:
      - { id: a, text: "No, namespaces isolate Pods" }
      - { id: b, text: "Yes — by default every Pod accepts connections from every other Pod; isolation starts only when a policy selects the Pod" }
      - { id: c, text: "Only if they share a label" }
    answer: b
    explanation: The lab's intruder Pod reaches the web Pod until the policy is applied. A common baseline is a default-deny policy per namespace, then explicit allows.
  - id: two-layers
    prompt: The web Pod is protected by a NetworkPolicy. Why still restrict its ServiceAccount with RBAC?
    options:
      - { id: a, text: "No need, one layer is enough" }
      - { id: b, text: "They guard different things: NetworkPolicy controls which Pods can connect to which; RBAC controls what an identity may do through the Kubernetes API (read Secrets, delete Pods). A compromised Pod is limited by both" }
      - { id: c, text: "RBAC makes the network faster" }
    answer: b
    explanation: Defence in depth — an attacker in one Pod should neither reach every service nor control the cluster through the API.
verification:
  method: executed
  details: Every command is run by the test suite on a kind cluster (Kubernetes 1.36.1, node image pinned by digest; kind enforces NetworkPolicy through kube-network-policies), after the first Kubernetes lesson, and its output is compared with this lesson. Behaviour was checked against the Kubernetes RBAC and NetworkPolicy documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Least privilege inside a cluster has two layers: **RBAC** decides what an identity may do through the Kubernetes API, and **NetworkPolicies** decide which Pods may connect to which — and by default, both are wide open in different ways.

## Explain it like I'm twelve

At school, a prefect's badge lets them check the attendance list but not change marks (**RBAC**: what you may do in the office). And the music room has a sign "choir members only" (**network policy**: who may walk in). A badge does not open doors, and a door sign does not grant office rights — a well-run school uses both.

Where the analogy breaks: RBAC starts closed (no badge, no rights), but Kubernetes networking starts open — every door is unlocked until a policy locks it.

## What problem it solves

Workloads talk to the Kubernetes API (to read configuration, watch Pods, scale things) and to each other. If one Pod is compromised — a vulnerable dependency, a leaked token — broad API rights let an attacker read every Secret or delete workloads, and open networking lets them probe every database. RBAC and NetworkPolicies shrink what one compromised Pod can reach.

## How it works

![](media:kubernetes/rbac-netpol.svg)

- A **ServiceAccount** is an identity for Pods. A **Role** lists allowed verbs on resources in one namespace; a **RoleBinding** grants it to subjects. (ClusterRole and ClusterRoleBinding do the same cluster-wide.) Permissions are purely additive — there are no deny rules.
- `kubectl auth can-i <verb> <resource> --as=system:serviceaccount:<ns>:<name>` asks the API server what an identity may do.
- By default a Pod accepts connections from anywhere. A **NetworkPolicy** that selects a Pod and lists `Ingress` in `policyTypes` isolates it: only connections matching its `from` rules are allowed. Policies need a network plugin that enforces them (kind's does).

## Try it yourself

> **Local lab** — continues on the kind cluster from *Deployments and self-healing* (`kind get clusters` should list `devforge`). Every command is run automatically in DevForge's tests; the last step deletes the cluster.

### 1. An identity with exactly one permission

```bash run
kubectl create namespace rbac-lab
n="-n rbac-lab"
kubectl $n create serviceaccount reporter
kubectl $n create role pod-reader --verb=get,list,watch --resource=pods
kubectl $n create rolebinding reporter-reads-pods --role=pod-reader --serviceaccount=rbac-lab:reporter
```

```text output
namespace/rbac-lab created
serviceaccount/reporter created
role.rbac.authorization.k8s.io/pod-reader created
rolebinding.rbac.authorization.k8s.io/reporter-reads-pods created
```

A reporting tool needs to list Pods — and nothing else. Ask the API server what `reporter` may do:

```bash run
as="--as=system:serviceaccount:rbac-lab:reporter"
for check in "list pods -n rbac-lab" "delete pods -n rbac-lab" "list secrets -n rbac-lab" "list pods -n default"; do
  echo "$check: $(kubectl auth can-i $check $as)"
done
```

```text output
list pods -n rbac-lab: yes
delete pods -n rbac-lab: no
list secrets -n rbac-lab: no
list pods -n default: no
```

The Role is namespaced, so the binding gives nothing in `default`, and nothing beyond reading Pods anywhere.

### 2. Acting as the ServiceAccount

```bash run
kubectl $n run web --image=nginx:1.27-alpine --labels=app=web > /dev/null
kubectl $n wait --for=condition=Ready pod/web --timeout=180s > /dev/null
kubectl $n get pods $as -o custom-columns=NAME:.metadata.name --no-headers
```

```text output
web
```

```bash run fails
kubectl $n delete pod web $as
```

```text output
Error from server (Forbidden): pods "web" is forbidden: User "system:serviceaccount:rbac-lab:reporter" cannot delete resource "pods" in API group "" in the namespace "rbac-lab"
```

The error names the identity, the verb, the resource and the namespace — exactly what to check when an application gets `403` from the API.

### 3. Networking is open by default

```bash run
kubectl $n expose pod web --port=80 > /dev/null
kubectl $n run frontend --image=busybox:1.37 --labels=app=frontend -- sleep 3600 > /dev/null
kubectl $n run intruder --image=busybox:1.37 --labels=app=intruder -- sleep 3600 > /dev/null
kubectl $n wait --for=condition=Ready pod/frontend pod/intruder --timeout=180s > /dev/null
reach() { kubectl $n exec "$1" -- wget -qO /dev/null -T 2 http://web > /dev/null 2>&1 && echo "$1 -> web: allowed" || echo "$1 -> web: blocked"; }
reach frontend
reach intruder
```

```text output
frontend -> web: allowed
intruder -> web: allowed
```

Any Pod can reach `web` — including one that has no business doing so.

### 4. Only the frontend may connect

```bash run
cat > policy.yaml <<'EOF'
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: web-only-from-frontend
  namespace: rbac-lab
spec:
  podSelector:
    matchLabels: { app: web }       # the Pods this policy protects
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector:
            matchLabels: { app: frontend }
      ports:
        - { protocol: TCP, port: 80 }
EOF
kubectl apply -f policy.yaml
# The network plugin applies the policy within moments; wait for the intruder to be blocked.
for i in $(seq 1 30); do [ "$(reach intruder)" = "intruder -> web: blocked" ] && break; sleep 1; done
reach frontend
reach intruder
```

```text output
networkpolicy.networking.k8s.io/web-only-from-frontend created
frontend -> web: allowed
intruder -> web: blocked
```

- The policy selects `app=web` and lists `Ingress`, so `web` is now isolated for incoming traffic; only Pods labelled `app=frontend`, on port 80, may connect.
- The selection is by **label**: a Pod that could change its own labels could get in, which is one more reason to keep RBAC tight (who may create or edit Pods).

### 5. Clean up

```bash run
kind delete cluster --name devforge
```

## Common mistakes

- **Binding `cluster-admin` "to make it work".** Find the missing verb and resource in the Forbidden message and grant only that.
- **Using the namespace's `default` ServiceAccount for everything.** Give each workload its own, and set `automountServiceAccountToken: false` for Pods that never call the API.
- **Assuming NetworkPolicies work everywhere.** Without a plugin that enforces them, they are accepted and silently ignored.
- **Allowing ingress but forgetting egress and DNS.** An egress default-deny also blocks DNS lookups unless you allow traffic to the cluster DNS.
- **Policies that select nothing.** A typo in `matchLabels` protects no Pod; test with a Pod that should be blocked, as here.

## Where this fits in a real system

Platform teams create a namespace per application with a default-deny NetworkPolicy and narrow Roles, often generated by **Terraform** or Helm in **GitHub Actions** pipelines. **Prometheus** needs a ClusterRole to discover targets, and its own network policy to scrape them; operators for **PostgreSQL** or **Kafka** ship their RBAC rules — read them before installing.
