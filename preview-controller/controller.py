"""Namespace-scoped preview lifecycle using Kopf's watch, retry, and finalizer support."""
import base64
import datetime as dt
import hashlib
import secrets

import kopf
from kubernetes import client, config, dynamic
from kubernetes.client.exceptions import ApiException

GROUP = "previews.request-tracker.dev"
VERSION = "v1"
PLURAL = "previewenvironments"
OWNER = GROUP + "/owner-uid"
FINALIZER = GROUP + "/cleanup"
NAMESPACE = "preview-lab"
api = None


class Blocked(Exception):
    def __init__(self, reason, message):
        self.reason, self.message = reason, message


def resource(version, kind):
    return api.resources.get(api_version=version, kind=kind)


def read(version, kind, namespace, name):
    try:
        return resource(version, kind).get(namespace=namespace, name=name).to_dict()
    except ApiException as error:
        if error.status == 404:
            return None
        raise


def owned(item, uid, retained=False):
    if item.get("metadata", {}).get("labels", {}).get(OWNER) != uid:
        return False
    refs = item["metadata"].get("ownerReferences", [])
    return not refs if retained else any(x.get("uid") == uid and x.get("controller") for x in refs)


def require_owner(item, uid, retained=False):
    if item and not owned(item, uid, retained):
        raise Blocked("OwnershipConflict", f"Refusing to adopt {item['kind']}/{item['metadata']['name']}; remove the naming conflict or choose another preview.")


def contains(actual, desired):
    if isinstance(desired, dict):
        return isinstance(actual, dict) and all(k in actual and contains(actual[k], v) for k, v in desired.items())
    if isinstance(desired, list):
        return isinstance(actual, list) and len(actual) == len(desired) and all(contains(a, b) for a, b in zip(actual, desired))
    return actual == desired


def names(body):
    # Include the UID so recreating a CR name never adopts an earlier retained database.
    suffix = hashlib.sha256(body["metadata"]["uid"].encode()).hexdigest()[:10]
    return "pe-" + body["metadata"]["name"][:30].rstrip("-") + "-" + suffix


def metadata(body, name, retained=False):
    m = body["metadata"]
    value = {"name": name, "namespace": m["namespace"], "labels": {OWNER: m["uid"]}}
    if not retained:
        value["ownerReferences"] = [{"apiVersion": GROUP + "/v1", "kind": "PreviewEnvironment", "name": m["name"], "uid": m["uid"], "controller": True, "blockOwnerDeletion": True}]
    return value


def ensure(body, desired, retained=False):
    ns, name = body["metadata"]["namespace"], desired["metadata"]["name"]
    old = read(desired["apiVersion"], desired["kind"], ns, name)
    require_owner(old, body["metadata"]["uid"], retained)
    endpoint = resource(desired["apiVersion"], desired["kind"])
    if old is None:
        endpoint.create(namespace=ns, body=desired)
    elif not contains(old, desired):
        patch = dict(desired)
        patch["metadata"] = dict(desired["metadata"], resourceVersion=old["metadata"]["resourceVersion"])
        endpoint.patch(namespace=ns, name=name, body=patch, content_type="application/merge-patch+json")


def conditions(body, ready, reason, message):
    previous = body.get("status", {}).get("conditions", [])
    old = next((x for x in previous if x["type"] == "Ready"), {})
    status = "True" if ready else "False"
    transition = old.get("lastTransitionTime") if old.get("status") == status else None
    return [{"type": "Ready", "status": status, "reason": reason, "message": message,
             "observedGeneration": body["metadata"]["generation"],
             "lastTransitionTime": transition or dt.datetime.now(dt.timezone.utc).isoformat()}]


def status(body, ready, reason, message, expires):
    desired = {"conditions": conditions(body, ready, reason, message), "observedGeneration": body["metadata"]["generation"],
               "expiresAt": expires.isoformat(), "resourcePrefix": names(body)}
    if body.get("status") != desired:
        resource(GROUP + "/v1", "PreviewEnvironment").status.patch(namespace=body["metadata"]["namespace"], name=body["metadata"]["name"],
            body={"metadata": {"resourceVersion": body["metadata"]["resourceVersion"]}, "status": desired}, content_type="application/merge-patch+json")


def deployment(body, component, image, env=None, volumes=None, mounts=None):
    prefix = names(body)
    labels = {OWNER: body["metadata"]["uid"], GROUP + "/component": component}
    db = component == "db"
    container = {"name": component, "image": image, "imagePullPolicy": "IfNotPresent", "ports": [{"name": "http" if not db else "db", "containerPort": 5432 if db else 8080}],
        "resources": {"requests": {"cpu": "50m", "memory": "128Mi" if component != "frontend" else "32Mi"}, "limits": {"cpu": "500m", "memory": "512Mi" if component != "frontend" else "64Mi"}},
        "env": env or [], "volumeMounts": mounts or [],
        "securityContext": {"allowPrivilegeEscalation": False, "capabilities": {"drop": ["ALL"]}}}
    if db:
        probe = {"exec": {"command": ["pg_isready", "-U", "preview", "-d", "preview"]}, "periodSeconds": 3}
        container.update(readinessProbe=probe, livenessProbe=dict(probe, failureThreshold=10), startupProbe=dict(probe, failureThreshold=30))
    else:
        container["readinessProbe"] = {"httpGet": {"path": "/actuator/health/readiness" if component == "backend" else "/", "port": 8080}, "periodSeconds": 3}
        container["livenessProbe"] = {"httpGet": {"path": "/actuator/health/liveness" if component == "backend" else "/", "port": 8080}, "periodSeconds": 5}
        container["startupProbe"] = dict(container["livenessProbe"], failureThreshold=40)
    pod = {"automountServiceAccountToken": False, "terminationGracePeriodSeconds": 40, "containers": [container], "volumes": volumes or [],
           "securityContext": {"runAsNonRoot": True, "runAsUser": 70 if db else 101 if component == "frontend" else 10001,
                               "runAsGroup": 70 if db else 101 if component == "frontend" else 10001, "fsGroup": 70 if db else 101 if component == "frontend" else 10001,
                               "seccompProfile": {"type": "RuntimeDefault"}}}
    if component == "backend":
        container["securityContext"]["readOnlyRootFilesystem"] = True
        container["lifecycle"] = {"preStop": {"exec": {"command": ["sh", "-c", "sleep 5"]}}}
    return {"apiVersion": "apps/v1", "kind": "Deployment", "metadata": metadata(body, prefix + "-" + component),
            "spec": {"replicas": 1, "strategy": {"type": "Recreate"}, "selector": {"matchLabels": labels}, "template": {"metadata": {"labels": labels}, "spec": pod}}}


def reconcile(body):
    if body["metadata"]["namespace"] != NAMESPACE or body["metadata"].get("deletionTimestamp"):
        return
    created = dt.datetime.fromisoformat(body["metadata"]["creationTimestamp"].replace("Z", "+00:00"))
    expires = created + dt.timedelta(seconds=body["spec"]["ttlSeconds"])
    if dt.datetime.now(dt.timezone.utc) >= expires:
        resource(GROUP + "/v1", "PreviewEnvironment").delete(namespace=NAMESPACE, name=body["metadata"]["name"], body={"preconditions": {"uid": body["metadata"]["uid"]}})
        return
    prefix, uid, spec = names(body), body["metadata"]["uid"], body["spec"]
    retain = spec["storageRetentionPolicy"] == "Retain"
    try:
        pvc = read("v1", "PersistentVolumeClaim", NAMESPACE, prefix + "-data")
        secret = read("v1", "Secret", NAMESPACE, prefix + "-credentials")
        require_owner(pvc, uid, retain)
        require_owner(secret, uid, retain)
        if not secret:
            if pvc:
                raise Blocked("CredentialsMissing", "Database storage exists but its credential Secret is missing; restore the original Secret before reconciling.")
            # Create only: concurrent handlers must not rotate the first successful credentials.
            resource("v1", "Secret").create(namespace=NAMESPACE, body={"apiVersion": "v1", "kind": "Secret", "metadata": metadata(body, prefix + "-credentials", retain), "type": "Opaque",
                          "data": {"username": base64.b64encode(b"preview").decode(), "password": base64.b64encode(secrets.token_urlsafe(32).encode()).decode()}})
        elif not all(secret.get("data", {}).get(k) for k in ["username", "password"]):
            raise Blocked("InvalidCredentials", "Credential Secret is incomplete; restore its original username and password.")
        ensure(body, {"apiVersion": "v1", "kind": "PersistentVolumeClaim", "metadata": metadata(body, prefix + "-data", retain),
                      "spec": {"accessModes": ["ReadWriteOnce"], "storageClassName": "local-path", "resources": {"requests": {"storage": "256Mi"}}}}, retain)
        conf = f"server {{ listen 8080; root /usr/share/nginx/html; location / {{ try_files $uri $uri/ /index.html; }} location /api/ {{ proxy_pass http://{prefix}-backend:8080; }} }}"
        ensure(body, {"apiVersion": "v1", "kind": "ConfigMap", "metadata": metadata(body, prefix + "-nginx"), "data": {"default.conf": conf}})
        ensure(body, {"apiVersion": "networking.k8s.io/v1", "kind": "NetworkPolicy", "metadata": metadata(body, prefix + "-isolation"),
            "spec": {"podSelector": {"matchLabels": {OWNER: uid}}, "policyTypes": ["Ingress", "Egress"],
                "ingress": [{"from": [{"podSelector": {"matchLabels": {OWNER: uid}}}]}],
                "egress": [{"to": [{"podSelector": {"matchLabels": {OWNER: uid}}}]},
                    {"to": [{"namespaceSelector": {"matchLabels": {"kubernetes.io/metadata.name": "kube-system"}}, "podSelector": {"matchLabels": {"k8s-app": "kube-dns"}}}],
                     "ports": [{"protocol": "UDP", "port": 53}, {"protocol": "TCP", "port": 53}]}]}})
        for component in ["db", "backend", "frontend"]:
            labels = {OWNER: uid, GROUP + "/component": component}
            ensure(body, {"apiVersion": "v1", "kind": "Service", "metadata": metadata(body, prefix + "-" + component),
                          "spec": {"selector": labels, "ports": [{"name": "db" if component == "db" else "http", "port": 5432 if component == "db" else 8080, "targetPort": 5432 if component == "db" else 8080}]}})
        credential = lambda key: {"secretKeyRef": {"name": prefix + "-credentials", "key": key}}
        db_env = [{"name": "POSTGRES_DB", "value": "preview"}, {"name": "PGDATA", "value": "/var/lib/postgresql/data/pgdata"},
                  {"name": "POSTGRES_USER", "valueFrom": credential("username")}, {"name": "POSTGRES_PASSWORD", "valueFrom": credential("password")}]
        desired = [deployment(body, "db", "postgres:17-alpine", db_env, [{"name": "data", "persistentVolumeClaim": {"claimName": prefix + "-data"}}], [{"name": "data", "mountPath": "/var/lib/postgresql/data"}]),
            deployment(body, "backend", spec["backendImage"], [{"name": "SPRING_DATASOURCE_URL", "value": f"jdbc:postgresql://{prefix}-db:5432/preview"},
                {"name": "SPRING_DATASOURCE_USERNAME", "valueFrom": credential("username")}, {"name": "SPRING_DATASOURCE_PASSWORD", "valueFrom": credential("password")}],
                [{"name": "tmp", "emptyDir": {}}], [{"name": "tmp", "mountPath": "/tmp"}]),
            deployment(body, "frontend", spec["frontendImage"], volumes=[{"name": "nginx", "configMap": {"name": prefix + "-nginx"}}], mounts=[{"name": "nginx", "mountPath": "/etc/nginx/conf.d/default.conf", "subPath": "default.conf"}])]
        for item in desired:
            ensure(body, item)
        # Read actual generations so a previous Ready deployment cannot mask an image update.
        for item in desired:
            live = read("apps/v1", "Deployment", NAMESPACE, item["metadata"]["name"])
            if (live.get("status", {}).get("observedGeneration", 0) < live["metadata"]["generation"]
                    or live.get("status", {}).get("updatedReplicas", 0) != 1
                    or live.get("status", {}).get("availableReplicas", 0) != 1):
                pods = resource("v1", "Pod").get(namespace=NAMESPACE, label_selector=f"{OWNER}={uid}").to_dict()["items"]
                for pod in pods:
                    for cs in pod.get("status", {}).get("containerStatuses", []):
                        waiting = cs.get("state", {}).get("waiting", {})
                        if waiting.get("reason") in ["ImagePullBackOff", "ErrImagePull", "CrashLoopBackOff"]:
                            raise Blocked(waiting["reason"], f"{pod['metadata']['name']}: check the configured image, pod events, and container logs.")
                raise Blocked("Progressing", f"Waiting for {item['metadata']['name']} to have one available replica; inspect its pods and PVC events.")
        status(body, True, "Ready", "Frontend, backend, and database have available replicas.", expires)
    except Blocked as error:
        status(body, False, error.reason, error.message, expires)
    except ApiException as error:
        # API bodies may include Secret content; expose only the status code.
        status(body, False, "KubernetesAPIError", f"Kubernetes API returned {error.status}; check namespace permissions and controller connectivity.", expires)
        raise kopf.TemporaryError(f"Kubernetes API {error.status}", delay=5) from None


@kopf.on.startup()
def startup(settings, **_):
    global api
    config.load_incluster_config()
    api = dynamic.DynamicClient(client.ApiClient())
    settings.persistence.finalizer = FINALIZER
    settings.scanning.disabled = True
    settings.persistence.progress_storage = kopf.AnnotationsProgressStorage(prefix=GROUP)
    settings.posting.enabled = False
    settings.execution.default_backoff = 5


@kopf.on.create(GROUP, VERSION, PLURAL)
@kopf.on.update(GROUP, VERSION, PLURAL)
@kopf.on.resume(GROUP, VERSION, PLURAL)
@kopf.timer(GROUP, VERSION, PLURAL, interval=5)
def sync(body, **_):
    reconcile(body)


@kopf.on.delete(GROUP, VERSION, PLURAL)
def cleanup(body, **_):
    prefix, uid = names(body), body["metadata"]["uid"]
    targets = [("apps/v1", "Deployment", prefix + "-" + x, False) for x in ["frontend", "backend", "db"]]
    targets += [("v1", "Service", prefix + "-" + x, False) for x in ["frontend", "backend", "db"]]
    targets += [("v1", "ConfigMap", prefix + "-nginx", False)]
    targets += [("networking.k8s.io/v1", "NetworkPolicy", prefix + "-isolation", False)]
    if body["spec"]["storageRetentionPolicy"] == "Delete":
        targets += [("v1", "PersistentVolumeClaim", prefix + "-data", False), ("v1", "Secret", prefix + "-credentials", False)]
    for index, (version, kind, name, retained) in enumerate(targets):
        if index == 3:
            for v, k, n, retention in targets[:3]:
                deployment = read(v, k, NAMESPACE, n)
                if deployment and owned(deployment, uid, retention):
                    raise kopf.TemporaryError("Waiting for preview workloads to stop before removing dependencies", delay=2)
        old = read(version, kind, NAMESPACE, name)
        if not old:
            continue
        # A foreign naming conflict must never be deleted, even during finalization.
        if not owned(old, uid, retained):
            continue
        try:
            resource(version, kind).delete(namespace=NAMESPACE, name=name,
                body={"preconditions": {"uid": old["metadata"]["uid"]}, "propagationPolicy": "Foreground"})
        except ApiException as error:
            if error.status != 404:
                raise kopf.TemporaryError(f"Cleanup API {error.status}", delay=5) from None
    for v, k, n, retained in targets:
        remaining = read(v, k, NAMESPACE, n)
        if remaining and owned(remaining, uid, retained):
            raise kopf.TemporaryError("Waiting for owned resources to finish deletion", delay=2)
