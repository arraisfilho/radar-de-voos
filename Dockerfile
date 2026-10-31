FROM node:22-bookworm-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
COPY config/currencies.json /build/config/currencies.json
RUN npm run build

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 RADAR_DATA_DIR=/data RADAR_NO_SEED=1
# SQLite temporary files (statement journals of large deletes, VACUUM) go to the data volume:
# /tmp is a 64 MB tmpfs in the Compose files.
ENV SQLITE_TMPDIR=/data
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 radar && useradd --uid 10001 --gid 10001 --no-create-home radar \
    && mkdir /data && chown radar:radar /data
COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock
COPY backend/ ./backend/
COPY config/ ./config/
COPY scripts/ ./scripts/
COPY frontend/src/messages.json ./frontend/src/messages.json
COPY --from=frontend /build/frontend/dist/ ./frontend/dist/
USER 10001:10001
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD python -c "import json,urllib.request; h=json.load(urllib.request.urlopen('http://127.0.0.1:8765/api/health',timeout=3)); assert h['ok'] and h['collector_alive'] and h['whatsapp_sender_alive']"
CMD ["python", "scripts/serve.py"]
