import os
from pathlib import Path
import subprocess
import time
import unittest
import urllib.request
import uuid


ROOT = Path(__file__).resolve().parents[1]


class FrontendLifecycleTest(unittest.TestCase):
    def test_delivery_drain_keeps_existing_probe_and_grace_budgets(self):
        for extra in [[], ["--set-string", "postgresql.existingSecret=request-tracker-k3s-db"]]:
            with self.subTest(parameters=extra):
                rendered = subprocess.check_output([
                    "helm", "template", "request-tracker-delivery", str(ROOT / "helm/request-tracker"),
                    "-f", str(ROOT / "delivery/values-kind.yaml"), *extra], text=True)
                frontend = next(doc for doc in rendered.split("---")
                                if "kind: Deployment\n" in doc
                                and "name: request-tracker-delivery-frontend\n" in doc)
                self.assertIn('command: [sh, -c, "sleep 5"]', frontend)
                self.assertIn("replicas: 1\n", frontend)
                self.assertIn("readinessProbe: {httpGet: {path: /, port: http}, periodSeconds: 5}", frontend)
                self.assertIn("livenessProbe: {httpGet: {path: /, port: http}, periodSeconds: 10}", frontend)
                # The unchanged Kubernetes default leaves 25s after the 5s hook.
                self.assertNotIn("terminationGracePeriodSeconds:", frontend)

    def test_baseline_frontend_lifecycle_is_unchanged(self):
        rendered = subprocess.check_output([
            "helm", "template", "request-tracker", str(ROOT / "helm/request-tracker")], text=True)
        frontend = next(doc for doc in rendered.split("---")
                        if "kind: Deployment\n" in doc and "name: request-tracker-frontend\n" in doc)
        self.assertNotIn("preStop:", frontend)
        self.assertIn("timeoutSeconds: 2", frontend)

    @unittest.skipUnless(os.environ.get("FRONTEND_LIFECYCLE_IMAGE"), "Set FRONTEND_LIFECYCLE_IMAGE for nginx smoke")
    def test_nginx_accepts_during_hook_then_exits_gracefully(self):
        name = "frontend-lifecycle-" + uuid.uuid4().hex[:12]
        image = os.environ["FRONTEND_LIFECYCLE_IMAGE"]
        hook = None
        try:
            subprocess.run(["docker", "run", "--detach", "--name", name,
                            "--add-host", "request-tracker:127.0.0.1",
                            "-p", "127.0.0.1::8080", image], check=True, capture_output=True)
            deadline = time.monotonic() + 15
            while True:
                logs = subprocess.check_output(["docker", "logs", name], stderr=subprocess.STDOUT, text=True)
                if "start worker process " in logs:
                    break
                self.assertLess(time.monotonic(), deadline, "nginx startup marker missing")
                time.sleep(0.05)
            port = subprocess.check_output(["docker", "port", name, "8080"], text=True).strip()
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

            def read_once():
                with opener.open("http://" + port + "/", timeout=3) as response:
                    self.assertEqual(response.status, 200)
                    response.read()

            read_once()
            hook = subprocess.Popen(["docker", "exec", name, "sh", "-c", "sleep 5; kill -QUIT 1"],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            # Waiting on the hook proves it remains in progress; HTTP failures are never retried.
            with self.assertRaises(subprocess.TimeoutExpired):
                hook.wait(timeout=2)
            read_once()
            self.assertEqual(hook.wait(timeout=6), 0)
            exit_code = subprocess.check_output(["docker", "wait", name], text=True, timeout=10).strip()
            self.assertEqual(exit_code, "0")
        finally:
            subprocess.run(["docker", "rm", "--force", name], capture_output=True, timeout=15)
            if hook is not None and hook.poll() is None:
                hook.wait(timeout=10)


if __name__ == "__main__":
    unittest.main()
