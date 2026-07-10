# golang-migrate image with NoMarkup schema baked in.
# Used by deploy/k8s/base/migration-job.yaml (Job runs `migrate ... up`).
#
# Build:
#   docker build -f deploy/docker/migrate.Dockerfile -t ghcr.io/nomarkup/migrate:TAG .
FROM migrate/migrate:v4.18.1

COPY database/migrations /migrations

# Entrypoint is `migrate`. Job supplies:
#   -path=/migrations -database=$(DATABASE_URL) up
ENTRYPOINT ["migrate"]
