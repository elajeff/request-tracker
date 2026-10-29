# Local Kubernetes deployment with kind

Request Tracker runs as a frontend, Spring Boot API, and PostgreSQL in a local kind cluster. Its database volume is separate from the Docker Compose database.

## Prerequisites

Docker Desktop, kubectl, kind, and Helm. Run the commands from the repository root in PowerShell.

## Build and load the images

Create the cluster only if it does not already exist:

    kind create cluster --name request-tracker --wait 120s

Build and load both images:

    docker build -t request-tracker:local .
    kind load docker-image request-tracker:local --name request-tracker
    docker build -t request-tracker-frontend:local -f frontend/Dockerfile frontend
    kind load docker-image request-tracker-frontend:local --name request-tracker

## Deploy

    helm lint .\helm\request-tracker
    kubectl create namespace request-tracker --dry-run=client -o yaml | kubectl apply -f -

For a fresh installation, create the database Secret with a randomly generated password. This command does not print the password or save it in the repository:

```powershell
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 32
$rng.GetBytes($bytes)
$dbPassword = [BitConverter]::ToString($bytes).Replace("-", "").ToLowerInvariant()
$rng.Dispose()

kubectl create secret generic request-tracker-db `
    --namespace request-tracker `
    --from-literal=username=request_tracker `
    "--from-literal=password=$dbPassword" `
    --dry-run=client -o yaml | kubectl apply -f -

if ($LASTEXITCODE -ne 0) { throw "Could not create database Secret." }
Remove-Variable rng, bytes, dbPassword -ErrorAction SilentlyContinue
```

Install or upgrade the Helm release:

    helm upgrade --install request-tracker .\helm\request-tracker --namespace request-tracker --set backend.sessionCookieSecure=false --wait --timeout 5m

The cookie override is for local HTTP access. Authentication-compatible images require account provisioning and a coordinated upgrade of both application routes; see [authentication](authentication.md#migration-and-deployment).

## Verify and access

    kubectl get pods,services,pvc -n request-tracker
    helm status request-tracker -n request-tracker
    kubectl auth can-i get pods --as=system:serviceaccount:request-tracker:request-tracker -n request-tracker

The permission check should return `no`: the application does not need access to the Kubernetes API.

In a separate PowerShell window, run this command and leave it running:

    kubectl port-forward -n request-tracker service/request-tracker-frontend 8081:80

Open http://127.0.0.1:8081 and test creating and updating a request.

## Optional cleanup

Only when intentionally removing the deployment, stop the port-forward with Ctrl+C and run:

    helm uninstall request-tracker -n request-tracker

The PostgreSQL PVC is normally retained when the release is uninstalled. Deleting the namespace or kind cluster can delete the Kubernetes database storage. The Compose database is separate.
