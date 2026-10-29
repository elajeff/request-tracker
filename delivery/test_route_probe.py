import threading
import unittest

from route_probe import probe, require_success


class RouteProbeTest(unittest.TestCase):
    def test_request_crossing_phase_boundary_keeps_dispatch_context(self):
        dispatched = threading.Event()
        complete = threading.Event()
        phase = "maintenance"
        records = []

        def send():
            dispatched.set()
            if not complete.wait(5):
                raise TimeoutError()
            return 401

        def sample():
            records.append(probe(send, route="frontend", phase=phase,
                                 expected_authentication="anonymous", expected_status=401))

        worker = threading.Thread(target=sample)
        worker.start()
        try:
            self.assertTrue(dispatched.wait(5))
            phase = "post-opening"
        finally:
            complete.set()
            worker.join(5)
        self.assertFalse(worker.is_alive())
        record = records[0]
        self.assertEqual(record["phaseAtDispatch"], "maintenance")
        self.assertEqual(record["expectedAuthentication"], "anonymous")
        self.assertEqual(record["status"], 401)
        self.assertLessEqual(record["dispatchedAt"], record["completedAt"])
        self.assertTrue(record["requestId"])

    def test_authenticated_401_fails_without_phase_filtering(self):
        record = probe(lambda: 401, route="frontend", phase="post-opening",
                       expected_authentication="SUPPORT")
        self.assertFalse(record["ok"])
        with self.assertRaises(RuntimeError):
            require_success([record])

    def test_network_failure_does_not_record_exception_contents(self):
        def send():
            raise OSError("sensitive response")

        record = probe(send, route="frontend", phase="post-opening",
                       expected_authentication="SUPPORT")
        self.assertEqual(record["status"], "network-error")
        self.assertNotIn("sensitive response", str(record))
        with self.assertRaises(RuntimeError):
            require_success([record])

    def test_empty_window_fails(self):
        with self.assertRaises(RuntimeError):
            require_success([])


if __name__ == "__main__":
    unittest.main()
