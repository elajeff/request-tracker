"""Steady signed-in traffic, so the canary analysis has requests to measure."""
import http.cookiejar
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = os.environ.get("TRAFFIC_BASE_URL", "http://request-tracker-delivery-frontend:80")
WORKERS = 4
INTERVAL_SECONDS = 0.2
TIMEOUT_SECONDS = 3


class Client:
    def __init__(self):
        cookies = urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), cookies)

    def call(self, path, data=None, headers=None):
        request = urllib.request.Request(BASE_URL + path, data=data, headers=headers or {})
        with self.opener.open(request, timeout=TIMEOUT_SECONDS) as response:
            body = response.read()
        return json.loads(body) if body else None

    def sign_in(self):
        session = self.call("/api/session")
        form = urllib.parse.urlencode({"username": os.environ["TRAFFIC_USERNAME"],
                                       "password": os.environ["TRAFFIC_PASSWORD"]}).encode()
        self.call("/api/session/login", form, {session["csrfHeaderName"]: session["csrfToken"],
                                               "Content-Type": "application/x-www-form-urlencoded"})


def worker(number):
    client = None
    ok = failed = 0
    while True:
        try:
            if client is None:
                client = Client()
                client.sign_in()
            queue = client.call("/api/requests?limit=5")
            client.call("/api/staff?limit=5")
            if queue["items"]:
                client.call(f"/api/requests/{queue['items'][0]['id']}/history?limit=5")
            ok += 1
        except urllib.error.HTTPError as error:
            failed += 1
            if error.code == 401:
                client = None  # Sign in again on the next round.
        except (OSError, ValueError, KeyError):
            failed += 1
        if (ok + failed) % 100 == 0:
            print(f"worker={number} ok={ok} failed={failed}", flush=True)
        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    threads = [threading.Thread(target=worker, args=(n,), daemon=True) for n in range(WORKERS)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
