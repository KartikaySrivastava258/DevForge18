---
id: kubernetes-persistent-volumes-and-statefulsets
title: Persistent volumes and StatefulSets
track: kubernetes
order: 6
level: advanced
estimated_minutes: 45
prerequisites: [kubernetes-deployments-and-self-healing]
learning_objectives:
  - Request storage with a PersistentVolumeClaim, and explain dynamic provisioning, binding modes and reclaim policies.
  - Show that data on a claim outlives the Pods that use it — and disappears when a claim with the Delete policy is deleted.
  - Run a StatefulSet and show its stable Pod names, per-Pod volumes and per-Pod DNS names.
  - Explain why deleting a StatefulSet keeps its volumes.
resources:
  - title: Persistent Volumes
    url: https://kubernetes.io/docs/concepts/storage/persistent-volumes/
    publisher: Kubernetes
    type: documentation
    level: intermediate
    official: true
    why: PersistentVolumes, claims, access modes, and the Delete reclaim policy, which removes the volume and its storage when the claim is deleted.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Storage Classes
    url: https://kubernetes.io/docs/concepts/storage/storage-classes/
    publisher: Kubernetes
    type: documentation
    level: intermediate
    official: true
    why: Dynamic provisioning, and WaitForFirstConsumer, which delays binding and provisioning until a Pod uses the claim.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: StatefulSets
    url: https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/
    publisher: Kubernetes
    type: documentation
    level: advanced
    official: true
    why: Stable network identities and storage, and that deleting or scaling down a StatefulSet does not delete its volumes.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Local Path Provisioner
    url: https://github.com/rancher/local-path-provisioner
    publisher: Rancher
    type: source-code
    level: advanced
    official: true
    why: The provisioner behind kind's default "standard" StorageClass — node-local directories, fine for learning, not for data that must survive a node.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: pending-claim
    prompt: A new claim stays Pending, and its StorageClass uses WaitForFirstConsumer. Is something broken?
    options:
      - { id: a, text: "Yes, the provisioner failed" }
      - { id: b, text: "No — the volume is only created once a Pod using the claim is scheduled, so it can be made where (on which node or zone) that Pod runs" }
      - { id: c, text: "Yes, the claim is too small" }
    answer: b
    explanation: The lab shows Pending until the writer Pod starts, then Bound. Check the Pod's events if it stays Pending after a Pod uses it.
  - id: reclaim
    prompt: A claim was provisioned by a StorageClass with reclaimPolicy Delete. You delete the claim. What happens to the data?
    options:
      - { id: a, text: "It is kept in case you need it" }
      - { id: b, text: "The PersistentVolume and the storage behind it are deleted — the data is gone" }
      - { id: c, text: "It moves to another claim" }
    answer: b
    explanation: Delete is the usual default for dynamically provisioned volumes. For data you cannot lose, use a class with Retain, take backups, and protect claims from casual deletion.
  - id: statefulset
    prompt: Pod db-0 of a StatefulSet is deleted. What comes back?
    options:
      - { id: a, text: "A Pod with a random name and an empty volume" }
      - { id: b, text: "A Pod named db-0 again, attached to the same claim data-db-0, with the same DNS name db-0.db" }
      - { id: c, text: "Nothing, until you recreate it" }
    answer: b
    explanation: That stable identity is what databases and clustered systems need — each member keeps its name and its own data.
verification:
  method: executed
  details: Every command is run by the test suite on a kind cluster (Kubernetes 1.36.1, node image pinned by digest; kind's default StorageClass uses the local-path provisioner), after the first Kubernetes lesson, and its output is compared with this lesson. Behaviour was checked against the Kubernetes documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Pods are disposable, so data lives in **volumes** that Pods *claim*: a **PersistentVolumeClaim** asks for storage, a **StorageClass** provisions it, and a **StatefulSet** gives each replica its own claim and a name that survives restarts.

## Explain it like I'm twelve

Pupils change every year, but the school's lockers stay. A pupil fills in a form ("one locker, small") — the **claim** — and the caretaker assigns one only when the pupil actually arrives (**WaitForFirstConsumer**). When a pupil leaves, their things stay in the locker for whoever has the claim next. In a team where each member's role matters — goalkeeper, captain — the *positions* keep their lockers even when players change (**StatefulSet**).

Where the analogy breaks: with the common "Delete" policy, handing in the form empties the locker for good.

## What problem it solves

Everything in a container's own filesystem disappears when the Pod is replaced — and Kubernetes replaces Pods constantly (updates, node failures, rescheduling). Databases, queues and file uploads need storage that outlives Pods, follows them to a new node where possible, and — for replicated systems — belongs to one specific member.

## How it works

![](media:kubernetes/storage.svg)

- A **PersistentVolumeClaim** (PVC) requests a size and an access mode (`ReadWriteOnce`: one node at a time). A **StorageClass** *dynamically provisions* a matching **PersistentVolume** (PV) — on a cloud disk in production, a local directory in kind.
- `volumeBindingMode: WaitForFirstConsumer` delays provisioning until a Pod using the claim is scheduled. `reclaimPolicy: Delete` removes the PV and its storage when the claim is deleted.
- A **StatefulSet** creates Pods `db-0`, `db-1`… in order. `volumeClaimTemplates` give each its own claim (`data-db-0` …), and a headless Service gives each a DNS name (`db-0.db.<namespace>.svc.cluster.local`).
- Deleting or scaling down a StatefulSet does **not** delete its claims — data safety first.

## Try it yourself

> **Local lab** — continues on the kind cluster from *Deployments and self-healing* (`kind get clusters` should list `devforge`). Every command is run automatically in DevForge's tests; the last step deletes the cluster.

### 1. The cluster's storage class, and a claim

```bash run
kubectl get storageclass -o custom-columns=NAME:.metadata.name,PROVISIONER:.provisioner,BINDING:.volumeBindingMode,RECLAIM:.reclaimPolicy
kubectl create namespace storage-lab
cat > pvc.yaml <<'EOF'
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: notes
  namespace: storage-lab
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 64Mi
EOF
kubectl apply -f pvc.yaml
sleep 2
kubectl -n storage-lab get pvc notes -o jsonpath='claim: {.status.phase}{"\n"}'
```

```text output
NAME       PROVISIONER             BINDING                RECLAIM
standard   rancher.io/local-path   WaitForFirstConsumer   Delete
namespace/storage-lab created
persistentvolumeclaim/notes created
claim: Pending
```

The claim is `Pending` on purpose: with `WaitForFirstConsumer`, nothing is provisioned until a Pod needs it.

### 2. Data that outlives its Pod

```bash run
n="-n storage-lab"
cat > writer.yaml <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: writer
  namespace: storage-lab
spec:
  containers:
    - name: app
      image: busybox:1.37
      command: ["sh", "-c", "echo \"lecture notes, written by Pod $(cat /proc/sys/kernel/random/uuid | cut -c1-4)\" >> /data/notes.txt && sleep 3600"]
      volumeMounts:
        - { name: notes, mountPath: /data }
  volumes:
    - name: notes
      persistentVolumeClaim: { claimName: notes }
EOF
kubectl apply -f writer.yaml > /dev/null
kubectl $n wait --for=condition=Ready pod/writer --timeout=180s > /dev/null
kubectl $n get pvc notes -o jsonpath='claim: {.status.phase}{"\n"}'
kubectl $n delete pod writer --wait > /dev/null
kubectl apply -f writer.yaml > /dev/null
kubectl $n wait --for=condition=Ready pod/writer --timeout=180s > /dev/null
kubectl $n exec writer -- wc -l /data/notes.txt
```

```text output
claim: Bound
2 /data/notes.txt
```

The claim bound when the first Pod started. That Pod wrote a line and was deleted; a new Pod with the same claim found the line and added its own — two lines, two Pods, one volume.

### 3. Deleting the claim deletes the data

```bash run
pv=$(kubectl $n get pvc notes -o jsonpath='{.spec.volumeName}')
kubectl $n delete pod writer --wait > /dev/null
kubectl $n delete pvc notes --wait > /dev/null
for i in $(seq 1 30); do kubectl get pv "$pv" > /dev/null 2>&1 || break; sleep 1; done
kubectl get pv "$pv" > /dev/null 2>&1 && echo "volume still exists" || echo "volume deleted with its claim"
```

```text output
volume deleted with its claim
```

With `reclaimPolicy: Delete`, the PersistentVolume — and the directory behind it — went with the claim. For data you cannot lose, use a class with `Retain`, and take backups regardless.

### 4. A StatefulSet: stable names and one volume per Pod

```bash run
cat > statefulset.yaml <<'EOF'
apiVersion: v1
kind: Service
metadata:
  name: db
  namespace: storage-lab
spec:
  clusterIP: None          # headless: DNS names for each Pod, no load balancing
  selector: { app: db }
  ports: [{ port: 80 }]
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: db
  namespace: storage-lab
spec:
  serviceName: db
  replicas: 2
  selector:
    matchLabels: { app: db }
  template:
    metadata:
      labels: { app: db }
    spec:
      containers:
        - name: db
          image: busybox:1.37
          # Write an identity file only once: a restarted Pod must find its own, not a new one.
          command: ["sh", "-c", "[ -f /data/id ] || echo \"created by $(hostname)\" > /data/id; sleep 3600"]
          volumeMounts:
            - { name: data, mountPath: /data }
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: [ReadWriteOnce]
        resources:
          requests:
            storage: 64Mi
EOF
kubectl apply -f statefulset.yaml
kubectl $n rollout status statefulset/db --timeout=240s > /dev/null
kubectl $n get pods -l app=db -o custom-columns=POD:.metadata.name --no-headers
kubectl $n get pvc -o custom-columns=CLAIM:.metadata.name,STATUS:.status.phase --no-headers
```

```text output
service/db created
statefulset.apps/db created
db-0
db-1
data-db-0   Bound
data-db-1   Bound
```

Ordered names instead of random suffixes, and one claim per Pod, named after it.

### 5. db-0 comes back as itself

```bash run
kubectl $n delete pod db-0 --wait > /dev/null
kubectl $n wait --for=condition=Ready pod/db-0 --timeout=180s > /dev/null
for p in db-0 db-1; do echo "$p reads: $(kubectl $n exec $p -- cat /data/id)"; done
kubectl $n exec db-1 -- nslookup db-0.db.storage-lab.svc.cluster.local > /dev/null && echo "db-1 can reach db-0 by name"
```

```text output
db-0 reads: created by db-0
db-1 reads: created by db-1
db-1 can reach db-0 by name
```

The replacement `db-0` got the same name and the same claim (`data-db-0`), so it found the identity file its predecessor wrote instead of creating a new one. It is reachable as `db-0.db` again — what a database replica needs to rejoin its cluster.

### 6. Deleting the StatefulSet keeps the data

```bash run
kubectl $n delete statefulset db --wait > /dev/null
kubectl $n get pvc -o custom-columns=CLAIM:.metadata.name,STATUS:.status.phase --no-headers
```

```text output
data-db-0   Bound
data-db-1   Bound
```

The Pods are gone; the claims remain, so recreating the StatefulSet would reattach the same data. Deleting them is a separate, deliberate step.

### 7. Clean up

```bash run
kind delete cluster --name devforge
```

## Common mistakes

- **Running a database as a Deployment with one shared claim.** Replicas then fight over one `ReadWriteOnce` volume. Use a StatefulSet (or a managed database).
- **Trusting node-local storage.** kind's local-path volumes live on one node; if it dies, so does the data. Production uses network or cloud disks — and backups.
- **Deleting a namespace "to clean up".** It deletes the claims in it, and with `Delete` the data.
- **Expecting storage to grow on its own.** A claim's size is fixed unless the StorageClass allows expansion.
- **Assuming a StatefulSet makes an application clustered.** It provides stable names and storage; replication between members is the application's job.

## Where this fits in a real system

Teams often run **PostgreSQL**, **Redis** and **Kafka** in Kubernetes with StatefulSets — usually through an operator that handles replication, failover and backups — or keep databases outside the cluster as managed services. **Terraform** typically creates the cloud disks' StorageClasses, and **Prometheus** alerts before volumes fill up.
