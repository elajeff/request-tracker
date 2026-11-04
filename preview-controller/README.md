# Preview controller

A small Kubernetes controller that creates short-lived copies of the app. You describe a preview in a `PreviewEnvironment` resource, and the controller builds the frontend, backend and database for it, then removes them when they expire. It is a lab project for learning how controllers work, built with Kopf and the official Kubernetes Python client. It runs as a single replica in the `preview-lab` namespace of the k3s cluster (`k3d-request-tracker-k3s`) and has no access to your application namespaces.

## The resource

`previews.request-tracker.dev/v1`, kind `PreviewEnvironment`:

| Field | Meaning |
| --- | --- |
| `backendImage`, `frontendImage` | Required, must include a tag or digest |
| `ttlSeconds` | Lifetime from creation. Default 3600, allowed 60-86400 |
| `storageRetentionPolicy` | `Retain` (default) or `Delete`. Cannot be changed later |

Names must be DNS labels that start with a letter, at most 30 characters. See `example.yaml`.

## What each preview gets

- Its own frontend, backend and PostgreSQL Deployments with ClusterIP Services.
- Generated database credentials, stored only in a Secret.
- A 256Mi `local-path` volume for the database.
- A NetworkPolicy that allows traffic only between its own pods, plus DNS.
- Hardened pods: non-root, dropped capabilities, no service-account token, read-only root filesystem on the backend, and a five-second shutdown drain.

The namespace has a ResourceQuota. The resource status shows a Ready condition, the expiry time and the name prefix. Failures are reported with a reason such as an image pull error, a crash, an ownership conflict or missing credentials.

## Storage and cleanup

With `Retain`, the database volume and its Secret are kept after the preview is deleted, so the data can be recovered. With `Delete`, they are removed too, which destroys the data.

A preview with a recreated name gets a new UID and never adopts an older database. If the Secret is gone but the volume still exists, the controller stops with `CredentialsMissing` rather than generating a new password for an existing database. Objects the controller does not own are never adopted or deleted.

To recover retained data, find the matching volume and Secret by their owner-UID label, mount the volume in a separate PostgreSQL 17 pod at `/var/lib/postgresql/data` with `PGDATA=/var/lib/postgresql/data/pgdata`, and use the retained Secret's credentials. Never start a second PostgreSQL against a volume that is still mounted. To delete a retained pair on purpose, back it up first, confirm no pod mounts it, and delete only that exact pair.

Expiry starts cleanup on the next timer tick. It is not a hard deadline if the API, controller or storage is having problems.

## Running it

Build `Dockerfile` with a new, unique tag and import it into the cluster with k3d. Do not reuse a tag. Update the image in `lab.yaml`, then:

```sh
KUBE="--kubeconfig target/k3s-practice/kubeconfig.yaml --context k3d-request-tracker-k3s"
kubectl $KUBE apply -f preview-controller/crd.yaml -f preview-controller/lab.yaml
kubectl $KUBE apply -f preview-controller/example.yaml
python preview-controller/e2e.py --kubeconfig target/k3s-practice/kubeconfig.yaml \
    --context k3d-request-tracker-k3s --output target/preview-e2e.json
```

It also runs on a throwaway kind cluster. kind's storage class is called `standard`, so first create a StorageClass named `local-path` with the provisioner `rancher.io/local-path`. The script only accepts the context name above, so rename the context in a kubeconfig file that contains only the throwaway cluster.

The end-to-end script covers creation, readiness, image updates, drift repair, failures, recovery, deletion and expiry. It uses disposable previews only. It also briefly changes the controller's replica count to test ownership conflicts and restores it afterwards. Retained data from repeated runs uses up the quota.

Unit tests:

```sh
pip install -r preview-controller/requirements.txt -c preview-controller/constraints.txt
python -m unittest discover -s preview-controller -p 'test_*.py'
```

The Python base image and the PostgreSQL image are pinned by digest, and `constraints.txt` pins the tested dependency versions.

## Limits

There is no ingress, DNS, authentication, high availability or GitHub integration. The cluster administrator is trusted, and network policies do not protect against them. If the controller is down, deletions wait until it returns.
