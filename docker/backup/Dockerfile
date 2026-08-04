# ==============================================================================
# Workpulse — Backup sidecar image
#
# Tools inside:
#   - pg_dump / psql (postgres client 16)   → matches the Postgres server version
#   - rclone                                → S3-compatible upload (Cloudflare R2)
#   - age                                   → symmetric encryption
#   - bash + coreutils + tzdata             → for the cron loop
#   - supercronic                           → cron for containers (no root, no PID1 quirks)
# ==============================================================================

FROM alpine:3.20

RUN apk add --no-cache \
    bash \
    coreutils \
    curl \
    findutils \
    gzip \
    tzdata \
    postgresql16-client \
    rclone \
    age \
 && addgroup -S backup -g 1200 \
 && adduser -S -G backup -u 1200 backup

# supercronic — cron replacement designed for containers. Runs as non-root.
ARG SUPERCRONIC_VERSION=v0.2.32
RUN curl -fsSLo /usr/local/bin/supercronic \
    "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-amd64" \
 && chmod +x /usr/local/bin/supercronic

WORKDIR /home/backup

COPY --chown=backup:backup entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --chown=backup:backup run-backup.sh /usr/local/bin/run-backup.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/run-backup.sh

USER backup
ENV HOME=/home/backup

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
