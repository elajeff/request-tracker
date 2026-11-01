# Running on Kubernetes

The app runs as three pieces: the nginx frontend, the Spring Boot API and PostgreSQL. The Helm chart in `helm/request-tracker` deploys all three. It has been tested on kind (the main setup) and k3s (through k3d).

You need Docker Desktop, kubectl, kind and Helm.

## kind

Create the cluster and load the images:

```sh
kind create cluster --name request-tracker --wait 120s
docker build -t request-tracker:local .
docker build -t request-tracker-frontend:local -f frontend/Dockerfile frontend
kind load docker-image request-tracker:local --name request-tracker
kind load docker-image request-tracker-frontend:local --name request-tracker
```

Create the namespace and a database Secret with a random password (PowerShell):

```powershell
kubectl create namespace request-tracker
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$dbPassword = [BitConverter]::ToString($bytes).Replace("-", "").ToLowerInvariant()
kubectl create secret generic request-tracker-db -n request-tracker `
    --from-literal=username=request_tracker "--from-literal=password=$dbPassword"
Remove-Variable bytes, dbPassword
```

Install the chart. The cookie override is only for plain-HTTP local access:

```sh
helm upgrade --install request-tracker helm/request-tracker -n request-tracker \
    --set backend.sessionCookieSecure=false --wait --timeout 5m
```

Check it, then forward the frontend and open `http://127.0.0.1:8081`:

```sh
kubectl get pods,services,pvc -n request-tracker
kubectl port-forward -n request-tracker service/request-tracker-frontend 8081:80
```

You still need to [create an account](authentication.md#creating-accounts) before you can sign in.

To remove it, run `helm uninstall request-tracker -n request-tracker`. The database volume survives an uninstall, but deleting the namespace or the kind cluster deletes it.

## k3s

`k3s/cluster.yaml` creates a one-node k3s cluster with k3d, bound to `127.0.0.1:6551`, with a 5 GiB memory limit. Use its own kubeconfig and the `k3d-request-tracker-k3s` context so it never becomes your default:

```sh
k3d cluster create --config k3s/cluster.yaml
k3d kubeconfig get request-tracker-k3s > target/k3s-practice/kubeconfig.yaml
helm upgrade --install request-tracker helm/request-tracker \
    --kubeconfig target/k3s-practice/kubeconfig.yaml --kube-context k3d-request-tracker-k3s \
    -n request-tracker -f k3s/values.yaml --wait
```

Before installing, import the same `local` images you built for kind with `k3d image import request-tracker:local request-tracker-frontend:local -c request-tracker-k3s`, and create a `request-tracker-k3s-db` Secret with fresh database credentials; do not copy the kind ones. Check that you have enough memory and disk before running both clusters at once.

## Delivery mode

For canary releases, install the same chart with `-f delivery/values-kind.yaml`. See [canary delivery](canary-delivery.md).
