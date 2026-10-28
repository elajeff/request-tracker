import collections
import json
import threading
import time
import urllib.error
import urllib.request

counts = collections.Counter()
lock = threading.Lock()
paths = ["/api/requests?limit=5", "/api/staff?limit=5",
         "/api/requests/54f35b91-dbfc-4b95-9570-da8c80dd5dea/history?limit=5"]


def worker():
    index = 0
    while True:
        started = time.monotonic()
        request = urllib.request.Request("http://request-tracker-delivery:8080" + paths[index % len(paths)],
                                         headers={"Connection": "close"})
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                response.read()
                status = response.status
        except urllib.error.HTTPError as error:
            status = error.code
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
