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
DATABASE_IMAGE = "postgres:17-alpine@sha256:eee6c6e1b0894fa4fe0075eb054af9fd1cf39a35321c2d4110626cfe506411fb"
# Each preview runs these three parts, in this order.
COMPONENTS = {
    "db": {"port": 5432, "port_name": "db", "user": 70, "memory": ("128Mi", "512Mi")},
    "backend": {"port": 8080, "port_name": "http", "user": 10001, "memory": ("128Mi", "512Mi")},
    "frontend": {"port": 8080, "port_name": "http", "user": 101, "memory": ("32Mi", "64Mi")},
}
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
        raise Blocked("OwnershipConflict", f"Refusing to adopt {item['kind']}/{item['metadata']['name']}; "
                      "remove the naming conflict or choose another preview.")


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
        value["ownerReferences"] = [{"apiVersion": GROUP + "/v1", "kind": "PreviewEnvironment", "name": m["name"],
                                     "uid": m["uid"], "controller": True, "blockOwnerDeletion": True}]
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
        resource(GROUP + "/v1", "PreviewEnvironment").status.patch(
            namespace=body["metadata"]["namespace"], name=body["metadata"]["name"],
            body={"metadata": {"resourceVersion": body["metadata"]["resourceVersion"]}, "status": desired},
            content_type="application/merge-patch+json")


def probes(component):
    if component == "db":
        check = {"exec": {"command": ["pg_isready", "-U", "preview", "-d", "preview"]}, "periodSeconds": 3}
        return {"readinessProbe": check, "livenessProbe": dict(check, failureThreshold=10),
                "startupProbe": dict(check, failureThreshold=30)}
    backend = component == "backend"
    ready_path = "/actuator/health/readiness" if backend else "/"
    live_path = "/actuator/health/liveness" if backend else "/"
    liveness = {"httpGet": {"path": live_path, "port": 8080}, "periodSeconds": 5}
    return {"readinessProbe": {"httpGet": {"path": ready_path, "port": 8080}, "periodSeconds": 3},
            "livenessProbe": liveness, "startupProbe": dict(liveness, failureThreshold=40)}


def deployment(body, component, image, env=(), volumes=(), mounts=()):
    settings = COMPONENTS[component]
    labels = {OWNER: body["metadata"]["uid"], GROUP + "/component": component}
    memory_request, memory_limit = settings["memory"]
    container = {
        "name": component, "image": image, "imagePullPolicy": "IfNotPresent",
        "ports": [{"name": settings["port_name"], "containerPort": settings["port"]}],
        "resources": {"requests": {"cpu": "50m", "memory": memory_request}, "limits": {"cpu": "500m", "memory": memory_limit}},
        "env": list(env), "volumeMounts": list(mounts),
        "securityContext": {"allowPrivilegeEscalation": False, "capabilities": {"drop": ["ALL"]}},
        **probes(component),
    }
    if component == "backend":
        container["securityContext"]["readOnlyRootFilesystem"] = True
        container["lifecycle"] = {"preStop": {"exec": {"command": ["sh", "-c", "sleep 5"]}}}
    user = settings["user"]
    pod = {"automountServiceAccountToken": False, "terminationGracePeriodSeconds": 40, "containers": [container],
           "volumes": list(volumes),
           "securityContext": {"runAsNonRoot": True, "runAsUser": user, "runAsGroup": user, "fsGroup": user,
                               "seccompProfile": {"type": "RuntimeDefault"}}}
    return {"apiVersion": "apps/v1", "kind": "Deployment", "metadata": metadata(body, names(body) + "-" + component),
            "spec": {"replicas": 1, "strategy": {"type": "Recreate"}, "selector": {"matchLabels": labels},
                     "template": {"metadata": {"labels": labels}, "spec": pod}}}


def ensure_credentials(body, retain):
    prefix, uid = names(body), body["metadata"]["uid"]
    pvc = read("v1", "PersistentVolumeClaim", NAMESPACE, prefix + "-data")
    secret = read("v1", "Secret", NAMESPACE, prefix + "-credentials")
    require_owner(pvc, uid, retain)
    require_owner(secret, uid, retain)
    if secret:
        if not all(secret.get("data", {}).get(k) for k in ["username", "password"]):
            raise Blocked("InvalidCredentials", "Credential Secret is incomplete; restore its original username and password.")
        return
    if pvc:
        raise Blocked("CredentialsMissing", "Database storage exists but its credential Secret is missing; "
                      "restore the original Secret before reconciling.")
    # Create only: concurrent handlers must not rotate the first successful credentials.
    encode = lambda value: base64.b64encode(value.encode()).decode()
    resource("v1", "Secret").create(namespace=NAMESPACE, body={
        "apiVersion": "v1", "kind": "Secret", "metadata": metadata(body, prefix + "-credentials", retain), "type": "Opaque",
        "data": {"username": encode("preview"), "password": encode(secrets.token_urlsafe(32))}})


def supporting_objects(body):
    prefix, uid = names(body), body["metadata"]["uid"]
    nginx = (f"server {{ listen 8080; root /usr/share/nginx/html; location / {{ try_files $uri $uri/ /index.html; }} "
             f"location /api/ {{ proxy_pass http://{prefix}-backend:8080; }} }}")
    own_pods = {"podSelector": {"matchLabels": {OWNER: uid}}}
    dns = {"to": [{"namespaceSelector": {"matchLabels": {"kubernetes.io/metadata.name": "kube-system"}},
                   "podSelector": {"matchLabels": {"k8s-app": "kube-dns"}}}],
           "ports": [{"protocol": "UDP", "port": 53}, {"protocol": "TCP", "port": 53}]}
    objects = [
        {"apiVersion": "v1", "kind": "ConfigMap", "metadata": metadata(body, prefix + "-nginx"), "data": {"default.conf": nginx}},
        {"apiVersion": "networking.k8s.io/v1", "kind": "NetworkPolicy", "metadata": metadata(body, prefix + "-isolation"),
         "spec": {**own_pods, "policyTypes": ["Ingress", "Egress"], "ingress": [{"from": [own_pods]}],
                  "egress": [{"to": [own_pods]}, dns]}},
    ]
    for component, settings in COMPONENTS.items():
        objects.append({"apiVersion": "v1", "kind": "Service", "metadata": metadata(body, prefix + "-" + component),
                        "spec": {"selector": {OWNER: uid, GROUP + "/component": component},
                                 "ports": [{"name": settings["port_name"], "port": settings["port"], "targetPort": settings["port"]}]}})
    return objects


def deployments(body):
    prefix, spec = names(body), body["spec"]
    credential = lambda key: {"secretKeyRef": {"name": prefix + "-credentials", "key": key}}
    db_env = [{"name": "POSTGRES_DB", "value": "preview"}, {"name": "PGDATA", "value": "/var/lib/postgresql/data/pgdata"},
              {"name": "POSTGRES_USER", "valueFrom": credential("username")},
              {"name": "POSTGRES_PASSWORD", "valueFrom": credential("password")}]
    backend_env = [{"name": "SPRING_DATASOURCE_URL", "value": f"jdbc:postgresql://{prefix}-db:5432/preview"},
                   {"name": "SPRING_DATASOURCE_USERNAME", "valueFrom": credential("username")},
                   {"name": "SPRING_DATASOURCE_PASSWORD", "valueFrom": credential("password")}]
    return [
        deployment(body, "db", DATABASE_IMAGE, db_env,
                   [{"name": "data", "persistentVolumeClaim": {"claimName": prefix + "-data"}}],
                   [{"name": "data", "mountPath": "/var/lib/postgresql/data"}]),
        deployment(body, "backend", spec["backendImage"], backend_env,
                   [{"name": "tmp", "emptyDir": {}}], [{"name": "tmp", "mountPath": "/tmp"}]),
        deployment(body, "frontend", spec["frontendImage"],
                   volumes=[{"name": "nginx", "configMap": {"name": prefix + "-nginx"}}],
                   mounts=[{"name": "nginx", "mountPath": "/etc/nginx/conf.d/default.conf", "subPath": "default.conf"}]),
    ]


def require_rolled_out(body, items):
    # Read actual generations so a previous Ready deployment cannot mask an image update.
    uid = body["metadata"]["uid"]
    for item in items:
        live = read("apps/v1", "Deployment", NAMESPACE, item["metadata"]["name"])
        state = live.get("status", {})
        if (state.get("observedGeneration", 0) >= live["metadata"]["generation"]
                and state.get("updatedReplicas", 0) == 1 and state.get("availableReplicas", 0) == 1):
            continue
        pods = resource("v1", "Pod").get(namespace=NAMESPACE, label_selector=f"{OWNER}={uid}").to_dict()["items"]
        for pod in pods:
            for container in pod.get("status", {}).get("containerStatuses", []):
                waiting = container.get("state", {}).get("waiting", {})
                if waiting.get("reason") in ["ImagePullBackOff", "ErrImagePull", "CrashLoopBackOff"]:
                    raise Blocked(waiting["reason"], f"{pod['metadata']['name']}: check the configured image, pod events, and container logs.")
        raise Blocked("Progressing", f"Waiting for {item['metadata']['name']} to have one available replica; inspect its pods and PVC events.")


def reconcile(body):
    meta = body["metadata"]
    if meta["namespace"] != NAMESPACE or meta.get("deletionTimestamp"):
        return
    created = dt.datetime.fromisoformat(meta["creationTimestamp"].replace("Z", "+00:00"))
    expires = created + dt.timedelta(seconds=body["spec"]["ttlSeconds"])
    if dt.datetime.now(dt.timezone.utc) >= expires:
        resource(GROUP + "/v1", "PreviewEnvironment").delete(namespace=NAMESPACE, name=meta["name"],
                                                             body={"preconditions": {"uid": meta["uid"]}})
        return
    retain = body["spec"]["storageRetentionPolicy"] == "Retain"
    try:
        ensure_credentials(body, retain)
        ensure(body, {"apiVersion": "v1", "kind": "PersistentVolumeClaim", "metadata": metadata(body, names(body) + "-data", retain),
                      "spec": {"accessModes": ["ReadWriteOnce"], "storageClassName": "local-path",
                               "resources": {"requests": {"storage": "256Mi"}}}}, retain)
        for item in supporting_objects(body):
            ensure(body, item)
        workloads = deployments(body)
        for item in workloads:
            ensure(body, item)
        require_rolled_out(body, workloads)
        status(body, True, "Ready", "Frontend, backend, and database have available replicas.", expires)
    except Blocked as error:
        status(body, False, error.reason, error.message, expires)
    except ApiException as error:
        # API bodies may include Secret content; expose only the status code.
        status(body, False, "KubernetesAPIError",
               f"Kubernetes API returned {error.status}; check namespace permissions and controller connectivity.", expires)
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
    try:
        reconcile(body)
    except ApiException as error:
        raise kopf.TemporaryError(f"Kubernetes API {error.status}", delay=5) from None


@kopf.on.delete(GROUP, VERSION, PLURAL)
def cleanup(body, **_):
    try:
        cleanup_owned(body)
    except ApiException as error:
        raise kopf.TemporaryError(f"Cleanup API {error.status}", delay=5) from None


def delete_owned(targets, uid):
    for version, kind, name in targets:
        old = read(version, kind, NAMESPACE, name)
        # A foreign naming conflict must never be deleted, even during finalization.
        if not old or not owned(old, uid):
            continue
        try:
            resource(version, kind).delete(namespace=NAMESPACE, name=name,
                                           body={"preconditions": {"uid": old["metadata"]["uid"]}, "propagationPolicy": "Foreground"})
        except ApiException as error:
            if error.status != 404:
                raise kopf.TemporaryError(f"Cleanup API {error.status}", delay=5) from None


def any_owned(targets, uid):
    return any((item := read(version, kind, NAMESPACE, name)) and owned(item, uid) for version, kind, name in targets)


def cleanup_owned(body):
    prefix, uid = names(body), body["metadata"]["uid"]
    parts = list(reversed(COMPONENTS))  # Frontend first, database last.
    workloads = [("apps/v1", "Deployment", prefix + "-" + part) for part in parts]
    dependencies = [("v1", "Service", prefix + "-" + part) for part in parts]
    dependencies += [("v1", "ConfigMap", prefix + "-nginx"), ("networking.k8s.io/v1", "NetworkPolicy", prefix + "-isolation")]
    if body["spec"]["storageRetentionPolicy"] == "Delete":
        dependencies += [("v1", "PersistentVolumeClaim", prefix + "-data"), ("v1", "Secret", prefix + "-credentials")]
    # Stop the pods before removing what they depend on.
    delete_owned(workloads, uid)
    if any_owned(workloads, uid):
        raise kopf.TemporaryError("Waiting for preview workloads to stop before removing dependencies", delay=2)
    delete_owned(dependencies, uid)
    if any_owned(dependencies, uid):
        raise kopf.TemporaryError("Waiting for owned resources to finish deletion", delay=2)
