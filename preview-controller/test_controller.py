import copy
import datetime as dt
import unittest
from unittest.mock import Mock, patch

import controller as c


class ControllerTests(unittest.TestCase):
    def body(self, uid="1"):
        return {"metadata": {"name": "demo", "namespace": "preview-lab", "uid": uid, "generation": 1}}

    def test_names_separate_recreated_previews(self):
        self.assertNotEqual(c.names(self.body("1")), c.names(self.body("2")))
        self.assertLessEqual(len(c.names(self.body()) + "-credentials"), 63)

    def test_defaults_do_not_cause_repeated_updates(self):
        body = self.body()
        desired = {"apiVersion": "v1", "kind": "Service", "metadata": c.metadata(body, "demo"), "spec": {"ports": [{"port": 8080}]}}
        live = copy.deepcopy(desired)
        live["metadata"]["resourceVersion"] = "4"
        live["spec"]["clusterIP"] = "10.0.0.1"
        live["spec"]["ports"][0]["protocol"] = "TCP"
        endpoint = Mock()
        with patch.object(c, "read", return_value=live), patch.object(c, "resource", return_value=endpoint):
            c.ensure(body, desired)
            c.ensure(body, desired)
        endpoint.patch.assert_not_called()
        endpoint.create.assert_not_called()

    def test_foreign_resource_is_never_patched(self):
        desired = {"apiVersion": "v1", "kind": "Service", "metadata": c.metadata(self.body(), "demo")}
        foreign = copy.deepcopy(desired)
        foreign["metadata"]["labels"][c.OWNER] = "another-uid"
        endpoint = Mock()
        with patch.object(c, "read", return_value=foreign), patch.object(c, "resource", return_value=endpoint):
            with self.assertRaises(c.Blocked):
                c.ensure(self.body(), desired)
        endpoint.patch.assert_not_called()
        endpoint.create.assert_not_called()

    def test_retained_storage_has_no_gc_owner(self):
        value = {"metadata": c.metadata(self.body(), "data", retained=True)}
        self.assertTrue(c.owned(value, "1", retained=True))
        self.assertFalse(c.owned(value, "2", retained=True))
        self.assertNotIn("ownerReferences", value["metadata"])

    def test_condition_preserves_transition_time_on_reason_change(self):
        body = self.body()
        first = c.conditions(body, False, "Progressing", "starting")
        body["status"] = {"conditions": first}
        second = c.conditions(body, False, "ImagePullBackOff", "check image")
        self.assertEqual(first[0]["lastTransitionTime"], second[0]["lastTransitionTime"])
        self.assertEqual(second[0]["reason"], "ImagePullBackOff")

    def test_drift_changes_are_detected(self):
        self.assertFalse(c.contains({"replicas": 2}, {"replicas": 1}))
        self.assertFalse(c.contains({"env": [{"name": "FOREIGN"}]}, {"env": []}))

    def test_lost_credentials_are_not_regenerated_for_existing_storage(self):
        body = self.body()
        body["metadata"]["creationTimestamp"] = dt.datetime.now(dt.timezone.utc).isoformat()
        body["spec"] = {"ttlSeconds": 3600, "storageRetentionPolicy": "Retain"}
        pvc = {"metadata": c.metadata(body, "data", retained=True)}
        with patch.object(c, "read", side_effect=[pvc, None]), patch.object(c, "ensure") as ensure, patch.object(c, "status") as status:
            c.reconcile(body)
        ensure.assert_not_called()
        self.assertEqual(status.call_args.args[2], "CredentialsMissing")

    def test_status_uses_the_status_subresource(self):
        body = self.body()
        body["metadata"]["resourceVersion"] = "12"
        endpoint = Mock()
        with patch.object(c, "resource", return_value=endpoint):
            c.status(body, False, "Progressing", "waiting", dt.datetime.now(dt.timezone.utc))
        endpoint.status.patch.assert_called_once()
        endpoint.patch.assert_not_called()

    def test_concurrent_secret_creation_cannot_rotate_credentials(self):
        body = self.body()
        body["metadata"].update(creationTimestamp=dt.datetime.now(dt.timezone.utc).isoformat(), resourceVersion="1")
        body["spec"] = {"ttlSeconds": 3600, "storageRetentionPolicy": "Retain"}
        endpoint = Mock()
        endpoint.create.side_effect = c.ApiException(status=409)
        with patch.object(c, "read", side_effect=[None, None]), patch.object(c, "resource", return_value=endpoint), patch.object(c, "status"):
            with self.assertRaises(c.kopf.TemporaryError):
                c.reconcile(body)
        endpoint.patch.assert_not_called()

    def test_expired_deadline_is_not_reset_on_reconcile_or_restart(self):
        body = self.body()
        body["metadata"]["creationTimestamp"] = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=90)).isoformat()
        body["spec"] = {"ttlSeconds": 60}
        endpoint = Mock()
        with patch.object(c, "resource", return_value=endpoint), patch.object(c, "ensure") as ensure:
            c.reconcile(copy.deepcopy(body))
            c.reconcile(copy.deepcopy(body))
        self.assertEqual(endpoint.delete.call_count, 2)
        self.assertEqual(endpoint.delete.call_args.kwargs["body"]["preconditions"]["uid"], "1")
        ensure.assert_not_called()

    def test_secret_api_errors_are_sanitized_before_status_and_retry(self):
        body = self.body()
        body["metadata"]["creationTimestamp"] = dt.datetime.now(dt.timezone.utc).isoformat()
        body["spec"] = {"ttlSeconds": 3600, "storageRetentionPolicy": "Retain"}
        with patch.object(c, "read", side_effect=c.ApiException(status=500, reason="credential-canary", http_resp=None)), patch.object(c, "status") as status:
            with self.assertRaises(c.kopf.TemporaryError) as error:
                c.reconcile(body)
        self.assertNotIn("credential-canary", str(error.exception))
        self.assertNotIn("credential-canary", str(status.call_args))

    def test_cleanup_retries_without_deleting_a_replaced_foreign_object(self):
        body = self.body()
        body["spec"] = {"storageRetentionPolicy": "Delete"}
        foreign = {"metadata": {"name": "foreign", "uid": "new-uid"}}
        endpoint = Mock()
        with patch.object(c, "read", return_value=foreign), patch.object(c, "resource", return_value=endpoint):
            c.cleanup(body)
            c.cleanup(body)
        endpoint.delete.assert_not_called()

    def test_cleanup_read_errors_do_not_expose_api_bodies(self):
        body = self.body()
        body["spec"] = {"storageRetentionPolicy": "Retain"}
        with patch.object(c, "read", side_effect=c.ApiException(status=500, reason="credential-canary")):
            with self.assertRaises(c.kopf.TemporaryError) as error:
                c.cleanup(body)
        self.assertNotIn("credential-canary", str(error.exception))

    def test_expiry_api_errors_are_sanitized(self):
        with patch.object(c, "reconcile", side_effect=c.ApiException(status=500, reason="credential-canary")):
            with self.assertRaises(c.kopf.TemporaryError) as error:
                c.sync(self.body())
        self.assertNotIn("credential-canary", str(error.exception))


if __name__ == "__main__":
    unittest.main()
