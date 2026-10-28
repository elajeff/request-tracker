$ErrorActionPreference = 'Stop'
$context = 'kind-request-tracker'
$cache = Join-Path $env:TEMP 'request-tracker-argo-bootstrap'
New-Item -ItemType Directory -Force -Path $cache | Out-Null
$bundles = @(
    @{ Namespace = 'argocd'; File = 'argocd-core.yaml'; Url = 'https://raw.githubusercontent.com/argoproj/argo-cd/v3.5.6/manifests/core-install.yaml' },
    @{ Namespace = 'argo-rollouts'; File = 'rollouts.yaml'; Url = 'https://github.com/argoproj/argo-rollouts/releases/download/v1.10.1/install.yaml' }
)
foreach ($bundle in $bundles) {
    kubectl --context $context create namespace $bundle.Namespace --dry-run=client -o yaml | kubectl --context $context apply -f -
    if ($LASTEXITCODE -ne 0) { throw 'Namespace bootstrap failed' }
    $file = Join-Path $cache $bundle.File
    Invoke-WebRequest -UseBasicParsing -Uri $bundle.Url -OutFile $file
    kubectl --context $context apply --server-side --field-manager=delivery-bootstrap -n $bundle.Namespace -f $file
    if ($LASTEXITCODE -ne 0) { throw 'Controller bootstrap failed' }
}
kubectl --context $context -n argocd scale deployment/argocd-applicationset-controller --replicas=0
if ($LASTEXITCODE -ne 0) { throw 'ApplicationSet scaling failed' }
kubectl --context $context -n argocd set resources statefulset/argocd-application-controller --requests=cpu=100m,memory=256Mi --limits=cpu=1,memory=1Gi
if ($LASTEXITCODE -ne 0) { throw 'Application controller sizing failed' }
kubectl --context $context -n argocd set resources deployment/argocd-repo-server --requests=cpu=100m,memory=128Mi --limits=cpu=500m,memory=512Mi
if ($LASTEXITCODE -ne 0) { throw 'Repository server sizing failed' }
kubectl --context $context -n argo-rollouts set resources deployment/argo-rollouts --requests=cpu=50m,memory=128Mi --limits=cpu=500m,memory=256Mi
if ($LASTEXITCODE -ne 0) { throw 'Controller sizing failed' }
# Apply application.yaml only after the reviewed desired-state branch is published.
