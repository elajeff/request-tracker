import collections
import http.cookiejar
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

counts = collections.Counter()
lock = threading.Lock()
base = os.environ.get("TRAFFIC_BASE_URL", "http://request-tracker-delivery:8080")
paths = ["/api/requests?limit=5", "/api/staff?limit=5",
         "/api/requests/" + os.environ["TRAFFIC_REQUEST_ID"] + "/history?limit=5"]


def login(client):
    with client.open(base + "/api/session", timeout=3) as response:
        session = json.load(response)
    data = urllib.parse.urlencode({"username": os.environ["TRAFFIC_USERNAME"],
                                   "password": os.environ["TRAFFIC_PASSWORD"]}).encode()
    request = urllib.request.Request(base + "/api/session/login", data=data,
                                     headers={session["csrfHeaderName"]: session["csrfToken"]})
    with client.open(request, timeout=3) as response:
        if response.status != 204:
            raise RuntimeError("Traffic account login failed")


def worker():
    index = 0
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    authenticated = False
    while True:
        started = time.monotonic()
        request = urllib.request.Request(base + paths[index % len(paths)],
                                         headers={"Connection": "close"})
        try:
            if not authenticated:
                login(client)
                authenticated = True
            with client.open(request, timeout=3) as response:
                response.read()
                status = response.status
        except urllib.error.HTTPError as error:
            status = error.code
            if status == 401:
                authenticated = False
        except OSError:
            status = "network-error"
        with lock:
            counts[str(status)] += 1
        index += 1
        time.sleep(max(0, 0.2 - (time.monotonic() - started)))


for _ in range(2):
    threading.Thread(target=worker, daemon=True).start()
while True:
    time.sleep(10)
    with lock:
        print(json.dumps(dict(counts)), flush=True)
