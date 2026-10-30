import copy
import unittest

from exercise_orchestration import GateError, promotion_budget, promotion_ready, wait_promotion


class PromotionDeadlineTest(unittest.TestCase):
    def setUp(self):
        self.spec = {"replicas": 4, "strategy": {"canary": {
            "maxSurge": 1, "maxUnavailable": 0, "steps": [
                {"setWeight": 25}, {"pause": {"duration": "45s"}}, {"analysis": {}},
                {"setWeight": 50}, {"pause": {"duration": "30s"}}, {"analysis": {}}, {"setWeight": 100}]}},
            "template": {"spec": {"containers": [{"image": "v6-good", "readinessProbe": {"periodSeconds": 5}}]}}}
        self.analysis = {"metrics": [{"count": 3, "interval": "15s"} for _ in range(3)]}
        self.measured = [35.651, 25.627, 26.672, 26.205]
        self.state = {"app": {"status": {"sync": {"revision": "revision", "status": "Synced"},
            "health": {"status": "Healthy"}}}, "rollout": {"metadata": {"uid": "rollout"},
            "spec": self.spec, "status": {"phase": "Healthy", "readyReplicas": 4,
                "currentPodHash": "candidate", "stableRS": "candidate"}}, "replicasets": [{
            "metadata": {"labels": {"rollouts-pod-template-hash": "candidate"}, "ownerReferences": [{"uid": "rollout"}]},
            "spec": {"replicas": 4, "template": {"spec": {"containers": [{"image": "v6-good"}]}}},
            "status": {"readyReplicas": 4, "availableReplicas": 4}}]}

    def test_budget_accounts_for_serial_startup_pauses_parallel_metrics_and_margin(self):
        budget = promotion_budget(self.spec, self.analysis, self.measured, 3.094)
        self.assertEqual(budget, {"pauseSeconds": 75, "analysisSeconds": 60,
            "serialStartupSeconds": 144, "syncSeconds": 5, "controllerMarginSeconds": 6,
            "probeMarginSeconds": 5, "workSeconds": 295, "finalReadSeconds": 5, "totalSeconds": 300})

    def test_changed_strategy_and_unbounded_analysis_rejected(self):
        self.spec["strategy"]["canary"]["maxSurge"] = 2
        with self.assertRaises(GateError):
            promotion_budget(self.spec, self.analysis, self.measured, 3.094)
        self.spec["strategy"]["canary"]["maxSurge"] = 1
        self.analysis["metrics"][0].pop("count")
        with self.assertRaises(GateError):
            promotion_budget(self.spec, self.analysis, self.measured, 3.094)

    def test_four_ready_candidates_required_aggregate_four_does_not_pass(self):
        self.assertTrue(promotion_ready(**self.state, revision="revision", image="v6-good"))
        self.state["replicasets"][0]["status"]["readyReplicas"] = 3
        # Aggregate rollout ready stays four; the fourth is an old stable replica.
        self.assertFalse(promotion_ready(**self.state, revision="revision", image="v6-good"))

    def test_wrong_hash_image_owner_or_argo_state_cannot_pass(self):
        for category in ["hash", "image", "owner", "argo"]:
            value = copy.deepcopy(self.state)
            if category == "hash": value["rollout"]["status"]["stableRS"] = "old"
            if category == "image": value["replicasets"][0]["spec"]["template"]["spec"]["containers"][0]["image"] = "old"
            if category == "owner": value["replicasets"][0]["metadata"]["ownerReferences"] = []
            if category == "argo": value["app"]["status"]["health"]["status"] = "Progressing"
            self.assertFalse(promotion_ready(**value, revision="revision", image="v6-good"))

    def test_final_boundary_read_observes_fourth_replica_without_request_retries(self):
        now, calls, records = [0], [], []
        budget = {"workSeconds": 3, "finalReadSeconds": 1, "totalSeconds": 4}
        def read(timeout):
            calls.append((now[0], timeout))
            value = copy.deepcopy(self.state)
            if now[0] < 3: value["replicasets"][0]["status"]["readyReplicas"] = 3
            return value
        def sleep(seconds): now[0] += seconds
        result = wait_promotion(read, "revision", "v6-good", budget, records.append,
                                monotonic=lambda: now[0], sleep=sleep)
        self.assertEqual(result["replicasets"][0]["status"]["readyReplicas"], 4)
        self.assertEqual(calls, [(0, 1), (2, 1), (3, 1)])
        self.assertTrue(records[-1]["final"])

    def test_late_final_read_and_three_ready_at_deadline_fail(self):
        for late in [False, True]:
            now, records = [0], []
            def read(timeout):
                value = copy.deepcopy(self.state)
                if now[0] >= 3 and late: now[0] += 2
                else: value["replicasets"][0]["status"]["readyReplicas"] = 3
                return value
            def sleep(seconds): now[0] += seconds
            with self.assertRaises(GateError):
                wait_promotion(read, "revision", "v6-good", {"workSeconds": 3,
                    "finalReadSeconds": 1, "totalSeconds": 4}, records.append,
                    monotonic=lambda: now[0], sleep=sleep)


if __name__ == "__main__":
    unittest.main()
