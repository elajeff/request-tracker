FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY controller.py .
USER 10001:10001
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 USER=preview-controller HOME=/tmp
ENTRYPOINT ["kopf", "run", "--standalone", "--namespace=preview-lab", "--liveness=http://0.0.0.0:8081/healthz", "/app/controller.py"]
