import os
from pathlib import Path
import subprocess
import time
import unittest
from unittest import mock
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
                self.assertIn("terminationGracePeriodSeconds: 30", frontend)
                self.assertEqual(frontend.count("preStop:"), 1)

    def test_baseline_drain_keeps_existing_probes_and_security(self):
        for extra in [[], ["--set-string", "postgresql.existingSecret=request-tracker-k3s-db"]]:
            with self.subTest(parameters=extra):
                rendered = subprocess.check_output([
                    "helm", "template", "request-tracker", str(ROOT / "helm/request-tracker"), *extra], text=True)
                frontend = next(doc for doc in rendered.split("---")
                                if "kind: Deployment\n" in doc and "name: request-tracker-frontend\n" in doc)
                self.assertIn('command: [sh, -c, "sleep 5"]', frontend)
                self.assertEqual(frontend.count("preStop:"), 1)
                self.assertIn("terminationGracePeriodSeconds: 30", frontend)
                self.assertIn("timeoutSeconds: 2", frontend)
                self.assertIn("runAsUser: 101", frontend)
                self.assertIn("runAsGroup: 101", frontend)
                self.assertIn("allowPrivilegeEscalation: false", frontend)

    @unittest.skipUnless(os.environ.get("FRONTEND_LIFECYCLE_IMAGE"), "Set FRONTEND_LIFECYCLE_IMAGE for nginx smoke")
    def test_nginx_accepts_during_hook_then_exits_gracefully(self):
        name = "frontend-lifecycle-" + uuid.uuid4().hex[:12]
        image = os.environ["FRONTEND_LIFECYCLE_IMAGE"]
        hook = None
        try:
            subprocess.run(["docker", "run", "--detach", "--name", name,
                            "--user", "101:101", "--cap-drop", "ALL",
                            "--security-opt", "no-new-privileges", "--read-only",
                            "--tmpfs", "/tmp:rw,nosuid,noexec,size=16m,mode=1777",
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
            commands = subprocess.check_output([
                "docker", "exec", name, "sh", "-c", "command -v sh; command -v sleep"], text=True).splitlines()
            self.assertEqual(len(commands), 2)
            self.assertTrue(all(command.startswith("/") for command in commands))
            signal = subprocess.check_output([
                "docker", "inspect", "--format", "{{.Config.StopSignal}}", name], text=True).strip()
            self.assertEqual(signal, "SIGQUIT")
            began = time.monotonic()
            hook = subprocess.Popen(["docker", "exec", name, "sh", "-c", "sleep 5"],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            reads = 0
            while hook.poll() is None:
                read_once()
                reads += 1
                self.assertLess(time.monotonic() - began, 10, "preStop hook did not finish")
                # Poll hook completion, never retry an HTTP failure.
                try:
                    hook.wait(timeout=0.2)
                except subprocess.TimeoutExpired:
                    pass
            self.assertEqual(hook.returncode, 0)
            self.assertGreaterEqual(time.monotonic() - began, 5)
            self.assertGreater(reads, 1)
            shutdown = time.monotonic()
            subprocess.run(["docker", "stop", "--time", "25", name], check=True,
                           capture_output=True, timeout=30)
            self.assertLess(time.monotonic() - shutdown, 20, "shutdown consumed the grace-period margin")
            exit_code = subprocess.check_output(["docker", "wait", name], text=True, timeout=10).strip()
            self.assertEqual(exit_code, "0")
            logs = subprocess.check_output(["docker", "logs", name], stderr=subprocess.STDOUT, text=True)
            self.assertIn("SIGQUIT) received, shutting down", logs)
        finally:
            try:
                cleanup = subprocess.run(["docker", "rm", "--force", name], capture_output=True, timeout=15)
            finally:
                if hook is not None and hook.poll() is None:
                    try:
                        hook.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        hook.kill()
                        hook.wait(timeout=5)
            self.assertEqual(cleanup.returncode, 0, "test container cleanup failed")

    @unittest.skipUnless(os.environ.get("FRONTEND_LIFECYCLE_IMAGE"), "Set FRONTEND_LIFECYCLE_IMAGE for nginx smoke")
    def test_failed_observation_cleans_up_container_and_hook(self):
        identity = uuid.uuid4()
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        original_open = opener.open
        hooks = []
        original_popen = subprocess.Popen

        def launch(*args, **kwargs):
            process = original_popen(*args, **kwargs)
            if args[0] == ["docker", "exec", "frontend-lifecycle-" + identity.hex[:12], "sh", "-c", "sleep 5"]:
                hooks.append(process)
            return process

        reads = 0

        def observe(*args, **kwargs):
            nonlocal reads
            reads += 1
            if reads == 2:
                raise RuntimeError("controlled observation failure")
            return original_open(*args, **kwargs)

        with mock.patch.object(uuid, "uuid4", return_value=identity), \
                mock.patch.object(urllib.request, "build_opener", return_value=opener), \
                mock.patch.object(opener, "open", side_effect=observe), \
                mock.patch.object(subprocess, "Popen", side_effect=launch):
            with self.assertRaisesRegex(RuntimeError, "controlled observation failure"):
                self.test_nginx_accepts_during_hook_then_exits_gracefully()
        self.assertEqual(reads, 2)
        self.assertEqual(len(hooks), 1)
        self.assertTrue(all(process.poll() is not None for process in hooks))
        remaining = subprocess.check_output([
            "docker", "ps", "--all", "--filter", "name=frontend-lifecycle-" + identity.hex[:12],
            "--format", "{{.Names}}"], text=True)
        self.assertEqual(remaining, "")


if __name__ == "__main__":
    unittest.main()
