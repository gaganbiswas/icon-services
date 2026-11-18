#!/bin/sh
# Local development only: creates a separate database for integration tests so
# they never touch development data. Runs once, when the volume is first created.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE DATABASE "${POSTGRES_DB}_test";
SQL
