FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY agent ./agent

# INTERN TASK (security): runs as root, same as the backend image.

EXPOSE 8080

CMD ["python", "-m", "agent.main"]
