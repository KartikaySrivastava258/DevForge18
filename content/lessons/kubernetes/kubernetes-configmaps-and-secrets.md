---
id: kubernetes-configmaps-and-secrets
title: ConfigMaps and Secrets
track: kubernetes
order: 4
level: intermediate
estimated_minutes: 40
prerequisites: [kubernetes-deployments-and-self-healing]
learning_objectives:
  - Keep configuration out of images with a ConfigMap, and pass it to a container as environment variables and as files.
  - Store a password in a Secret, and explain why base64 is not encryption and what actually protects a Secret.
  - Show that mounted files are updated after a ConfigMap changes but environment variables are not, and roll Pods to pick up the change.
  - Prevent accidental changes with an immutable ConfigMap.
resources:
  - title: ConfigMaps
    url: https://kubernetes.io/docs/concepts/configuration/configmap/
    publisher: Kubernetes
    type: documentation
    level: beginner
    official: true
    why: Consuming ConfigMaps as environment variables and volumes; mounted ConfigMaps are updated eventually (up to the kubelet sync period plus cache delay), environment variables only on Pod restart; immutable ConfigMaps.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Secrets
    url: https://kubernetes.io/docs/concepts/configuration/secret/
    publisher: Kubernetes
    type: documentation
    level: intermediate
    official: true
    why: Secrets are stored unencrypted in etcd by default; anyone with API access to them, or allowed to create a Pod in the namespace, can read them.
    verification: { status: verified, checked_on: 2026-11-26 }
  - title: Good practices for Kubernetes Secrets
    url: https://kubernetes.io/docs/concepts/security/secrets-good-practices/
    publisher: Kubernetes
    type: documentation
    level: advanced
    official: true
    why: Encryption at rest, least-privilege access to Secrets, and external secret stores.
    verification: { status: verified, checked_on: 2026-11-26 }
self_check:
  - id: base64
    prompt: kubectl get secret shows password as bGVzc29uLW9ubHktcHc=. Is the password protected?
    options:
      - { id: a, text: "Yes, it is encrypted" }
      - { id: b, text: "No — base64 is an encoding that anyone can reverse; what protects a Secret is who may read it (RBAC) and encryption at rest in etcd, which must be configured" }
      - { id: c, text: "Yes, only the cluster can decode it" }
    answer: b
    explanation: The lab decodes it with base64 -d. Limit who can get Secrets, and enable encryption at rest or use an external secret store.
  - id: env-vs-volume
    prompt: You change a ConfigMap. A running Pod reads one key as an environment variable and another from a mounted file. What does it see a minute or two later?
    options:
      - { id: a, text: "Both new values" }
      - { id: b, text: "The new file content, but the old environment variable — environment variables are set when the container starts" }
      - { id: c, text: "Neither changes until the cluster restarts" }
    answer: b
    explanation: The kubelet refreshes mounted ConfigMaps periodically. Environment variables need new Pods, for example kubectl rollout restart for a Deployment.
  - id: immutable
    prompt: Why mark a ConfigMap immutable?
    options:
      - { id: a, text: "It hides the data" }
      - { id: b, text: "It protects running applications from accidental changes, and the kubelet no longer has to watch it for updates; to change it you create a new ConfigMap and roll Pods to it" }
      - { id: c, text: "It makes the ConfigMap smaller" }
    answer: b
    explanation: The lab's patch is refused with "field is immutable when `immutable` is set". Versioned names (exam-dates-v2) make rollouts and rollbacks explicit.
verification:
  method: executed
  details: Every command is run by the test suite on a kind cluster (Kubernetes 1.36.1, node image pinned by digest), after the first Kubernetes lesson, and its output is compared with this lesson. The delay before a mounted file changes varies; the lab waits for it and shows only that it changed. Behaviour was checked against the Kubernetes documentation on 2026-11-26.
owner: content-team
last_reviewed: 2026-11-26
content_version: 1
---

## The idea in one sentence

Build one image and configure it per environment: **ConfigMaps** hold settings and **Secrets** hold credentials, and Kubernetes hands them to containers as **environment variables** or **files**.

## Explain it like I'm twelve

A school uses the same timetable app in every classroom. The app is identical; a card on each teacher's desk says which room, which class and what time lessons start (**ConfigMap**). The key to the exam cupboard is kept in a small locked box, not written on the card (**Secret**).

Where the analogy breaks: a Kubernetes Secret is only as "locked" as the cluster makes it — by default its box is just wrapped in paper (base64).

## What problem it solves

Settings baked into an image force a rebuild for every change and a different image per environment — and passwords in images leak to everyone who can pull them (as the Docker security lesson showed). Keeping configuration in the cluster lets the same tested image run in development, staging and production, with secrets managed and access-controlled separately.

## How it works

![](media:kubernetes/config-secrets.svg)

- A **ConfigMap** is a set of key–value pairs (values can be whole files). A **Secret** is the same shape, intended for confidential data, with values stored base64-encoded.
- A container can read a key as an **environment variable** (`configMapKeyRef`, `secretKeyRef`) or mount keys as **files** in a volume.
- Mounted files are refreshed by the kubelet some time after a change (up to its sync period plus a cache delay). Environment variables are fixed when the container starts.
- Secrets are stored **unencrypted in etcd by default**. They are protected by RBAC (who may read them), by encryption at rest (configured by the cluster administrator), and by giving Pods only the Secrets they need.

## Try it yourself

> **Local lab** — continues on the kind cluster from *Deployments and self-healing* (`kind get clusters` should list `devforge`). The password is for this lesson only. Every command is run automatically in DevForge's tests; the last step deletes the cluster.

### 1. A ConfigMap and a Secret

```bash run
kubectl create namespace config-lab
n="-n config-lab"
printf 'opening_hour=9\nmax_loans=3\n' > settings.ini
kubectl $n create configmap library-config --from-literal=GREETING="Welcome to the library" --from-file=settings.ini
kubectl $n create secret generic db-credentials --from-literal=password=lesson-only-pw
```

```text output
namespace/config-lab created
configmap/library-config created
secret/db-credentials created
```

`--from-file=settings.ini` stores the whole file under the key `settings.ini`. Now look at the Secret the way anyone allowed to read it can:

```bash run
kubectl $n get secret db-credentials -o jsonpath='{.data.password}'; echo
kubectl $n get secret db-credentials -o jsonpath='{.data.password}' | base64 -d; echo
```

```text output
bGVzc29uLW9ubHktcHc=
lesson-only-pw
```

Base64 is an encoding, not encryption — one command reverses it. Access control decides who can run the first command at all.

### 2. A Pod that uses both, as variables and as files

```bash run
cat > pod.yaml <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: library-app
  namespace: config-lab
spec:
  containers:
    - name: app
      image: busybox:1.37
      command: ["sh", "-c", "sleep 3600"]
      env:
        - name: GREETING
          valueFrom:
            configMapKeyRef: { name: library-config, key: GREETING }
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef: { name: db-credentials, key: password }
      volumeMounts:
        - { name: config, mountPath: /etc/library, readOnly: true }
        - { name: secrets, mountPath: /etc/secrets, readOnly: true }
  volumes:
    - name: config
      configMap: { name: library-config, items: [{ key: settings.ini, path: settings.ini }] }
    - name: secrets
      secret: { secretName: db-credentials, defaultMode: 0400 }
EOF
kubectl apply -f pod.yaml
kubectl $n wait --for=condition=Ready pod/library-app --timeout=180s
kubectl $n exec library-app -- sh -c 'echo "GREETING=$GREETING"; echo "password length: ${#DB_PASSWORD}"; cat /etc/library/settings.ini; stat -L -c "%a %n" /etc/secrets/password'
```

```text output
pod/library-app created
pod/library-app condition met
GREETING=Welcome to the library
password length: 14
opening_hour=9
max_loans=3
400 /etc/secrets/password
```

- `GREETING` and `DB_PASSWORD` arrived as environment variables; `settings.ini` and `password` as files.
- `defaultMode: 0400` makes the secret file readable by its owner only. (`stat -L` follows the symbolic links Kubernetes uses to swap files atomically.)
- The lab prints only the password's *length*: never print secrets into logs.

### 3. Change the configuration

```bash run
kubectl $n patch configmap library-config --type merge -p '{"data":{"GREETING":"Library closed today","settings.ini":"opening_hour=9\nmax_loans=5\n"}}'
# The kubelet refreshes mounted files periodically; wait for it (usually within a minute or two).
for i in $(seq 1 90); do kubectl $n exec library-app -- grep -q 'max_loans=5' /etc/library/settings.ini 2> /dev/null && break; sleep 2; done
kubectl $n exec library-app -- sh -c 'echo "GREETING=$GREETING"; cat /etc/library/settings.ini'
```

```text output
configmap/library-config patched
GREETING=Welcome to the library
opening_hour=9
max_loans=5
```

The mounted file now shows `max_loans=5` — but `GREETING` still has the old value: environment variables are set when the container starts. A new Pod picks it up:

```bash run
kubectl $n replace --force -f pod.yaml > /dev/null
kubectl $n wait --for=condition=Ready pod/library-app --timeout=180s > /dev/null
kubectl $n exec library-app -- sh -c 'echo "GREETING=$GREETING"'
```

```text output
GREETING=Library closed today
```

For a Deployment, `kubectl rollout restart deployment/<name>` replaces its Pods gradually, with no downtime.

### 4. Configuration that must not change underneath you

```bash run
cat > frozen.yaml <<'EOF'
apiVersion: v1
kind: ConfigMap
metadata:
  name: exam-dates-v1
  namespace: config-lab
data:
  term: "2026-autumn"
immutable: true
EOF
kubectl apply -f frozen.yaml
```

```text output
configmap/exam-dates-v1 created
```

```bash run fails
kubectl -n config-lab patch configmap exam-dates-v1 --type merge -p '{"data":{"term":"2027-spring"}}'
```

```text output
The ConfigMap "exam-dates-v1" is invalid: data: Forbidden: field is immutable when `immutable` is set
```

To change it, create `exam-dates-v2` and point the Deployment at it: the change becomes a normal, reversible rollout. (The kubelet also stops watching immutable ConfigMaps, which reduces load on large clusters.)

### 5. Clean up

```bash run
kind delete cluster --name devforge
```

## Common mistakes

- **Treating Secrets as encrypted.** By default they are not, at rest in etcd. Enable encryption at rest, restrict `get`/`list` on Secrets with RBAC, or use an external store (Vault, a cloud secret manager) through a CSI driver or operator.
- **Committing Secret manifests to Git.** The base64 value is the password. Use sealed or externally managed secrets instead.
- **Expecting environment variables to update.** They never do in a running container; roll the Pods.
- **Mounting with `subPath`.** Files mounted with `subPath` do not receive ConfigMap updates at all.
- **Printing configuration at startup "for debugging".** It puts secrets into logs.

## Where this fits in a real system

The same image moves through environments while ConfigMaps change per environment — often generated by Kustomize or Helm in **GitHub Actions** pipelines, or by **Terraform**. Secrets usually come from a vault, are rotated without rebuilding images, and are what applications use to reach **PostgreSQL**, **Redis** or **Kafka**.
