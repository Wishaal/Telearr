# Multi-stage: compile wheels (cryptg/bcrypt need a C toolchain) in the builder,
# ship a slim runtime with no compiler. Runs as a non-root UID via compose `user:`.
FROM python:3.14-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc build-essential && rm -rf /var/lib/apt/lists/*
WORKDIR /wheels
COPY requirements.txt .
RUN pip wheel --wheel-dir /wheels -r requirements.txt

FROM python:3.14-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN apt-get update && apt-get install -y --no-install-recommends curl \
        && rm -rf /var/lib/apt/lists/*
COPY --from=builder /wheels /wheels
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --no-index --find-links /wheels -r /app/requirements.txt \
        && rm -rf /wheels
WORKDIR /app
COPY app /app/app
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8790/healthz || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8790", "--workers", "1"]
