FROM python:3.11-slim

WORKDIR /app

# Requirements first so a code edit doesn't invalidate the pip layer.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# INTERN TASK (security): this container runs as root. The real backend
# Dockerfile creates an unprivileged user and USERs to it. Compare with
# cloud-container/docker/backend.Dockerfile.

EXPOSE 8000

# --reload is on because interns will be editing this constantly. It is a
# development setting and does not belong in a production image.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
