FROM python:3.13-slim@sha256:2d44738ebf4ce5f63b9d9ea871e9c7cfdc0426f7b0c97cac915fd88ded1d86bb
WORKDIR /app
COPY requirements.txt constraints.txt .
RUN pip install --no-cache-dir -r requirements.txt -c constraints.txt
COPY controller.py .
USER 10001:10001
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 USER=preview-controller HOME=/tmp
ENTRYPOINT ["kopf", "run", "--standalone", "--namespace=preview-lab", "--liveness=http://0.0.0.0:8081/healthz", "/app/controller.py"]
