# 0009 — Local S3-compatible object storage: SeaweedFS (replaces MinIO)

- **Status:** Approved
- **Date:** 2026-11-18
- **Approved by:** Project owner

## Context

`CLAUDE.md` §3 specified MinIO for local development. MinIO no longer publishes
community Docker images (`docker pull minio/minio` → "repository does not exist";
`quay.io/minio/minio` requires authentication), verified 2026-11-18.

## Decision

- Local development and CI use **SeaweedFS** (`chrislusf/seaweedfs:4.54`,
  Apache-2.0) running `server -s3` in Docker Compose.
- Application code uses only the standard S3 API (AWS SDK v3 S3 client, path-style
  addressing configurable) so storage stays replaceable.
- Production object storage is chosen together with hosting (owner question G49).

## Consequences

- `CLAUDE.md` §3 and Phase 1 updated to reference S3-compatible storage with
  SeaweedFS locally.
