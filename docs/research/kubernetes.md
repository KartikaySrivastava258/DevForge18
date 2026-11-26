# Kubernetes — research notes

Checked 2026-11-26 (UTC) unless stated. Reuse these in lessons; add to them instead of researching again.

## Versions used by lessons and CI

| Tool | Version | Where checked |
|---|---|---|
| kind | v0.32.0 | github.com/kubernetes-sigs/kind releases; checksum file `kind-linux-amd64.sha256sum` |
| kubectl | v1.36.1 | dl.k8s.io, with `kubectl.sha256` |
| Node image | `kindest/node:v1.36.1@sha256:3489c7674813ba5d8b1a9977baea8a6e553784dab7b84759d1014dbd78f7ebd5` | pinned by digest in every lesson |
| Default StorageClass in kind | `standard`, provisioner `rancher.io/local-path`, `WaitForFirstConsumer`, reclaim `Delete` | observed with `kubectl get storageclass` |

kind has enforced NetworkPolicy out of the box since v0.24.0, through sigs.k8s.io/kube-network-policies (kind v0.24.0 and v0.25.0 release notes).

## Facts confirmed (source → wording)

- ConfigMaps (kubernetes.io/docs/concepts/configuration/configmap/): mounted ConfigMaps are updated eventually, up to "the kubelet sync period + cache propagation delay"; "ConfigMaps consumed as environment variables are not updated automatically and require a pod restart"; `subPath` mounts get no updates; immutable since v1.19.
- Secrets (…/configuration/secret/): "stored unencrypted in the API server's underlying data store (etcd)" by default; anyone with API access, or allowed to create a Pod in the namespace, can read them. Good practices: …/security/secrets-good-practices/.
- Namespaces (…/overview/working-with-objects/namespaces/): names unique within a namespace, not across; DNS `<service-name>.<namespace-name>.svc.cluster.local`.
- Labels (…/overview/working-with-objects/labels/): equality-based and set-based selectors; comma means AND.
- Resource quotas (…/policy/resource-quotas/): exceeding a quota is rejected with HTTP 403 Forbidden and a message naming the constraint; CPU/memory quotas require requests or limits (LimitRange can default them).
- Storage (…/storage/persistent-volumes/, …/storage/storage-classes/): Delete reclaim removes the PV and its storage; WaitForFirstConsumer delays binding and provisioning until a Pod uses the claim.
- StatefulSets (…/workloads/controllers/statefulset/): stable network identities and storage; deleting or scaling down does not delete volumes.
- RBAC (…/reference/access-authn-authz/rbac/): permissions are purely additive, no deny rules; a Role is namespaced, a ClusterRole is not; service account usernames are `system:serviceaccount:<namespace>:<name>`.
- NetworkPolicy (…/services-networking/network-policies/): needs a network plugin that enforces it; by default a Pod is non-isolated for ingress (all inbound allowed); it becomes isolated for ingress when any policy selecting it lists Ingress in policyTypes; allowed lists combine additively.
- Ingress (…/services-networking/ingress/): "The Kubernetes project recommends using Gateway instead of Ingress. The Ingress API has been frozen" — generally available, no plans to remove it, no new features.
- Gateway API (…/services-networking/gateway/): "the successor to the Ingress API"; an add-on, role-oriented; needs an implementation (a controller) installed.

## Observed behaviour worth remembering

- A Pod without a readiness probe can show `1/1 Running` for a moment between starting and crashing (CI run 45846978767).
- Image-pull status alternates `ErrImagePull` / `ImagePullBackOff`; crash status alternates `Error` / `CrashLoopBackOff`; the NAME column width varies with the random Pod suffix.
- A mounted ConfigMap took about 80 seconds to update locally; wait for the condition, never a fixed time.
- `stat` on a mounted Secret file reports the symlink (777); `stat -L` reports the file mode.
