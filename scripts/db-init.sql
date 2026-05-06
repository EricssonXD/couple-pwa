-- Bootstrap extensions used by DuoSync.
-- Runs once on first container boot via docker-entrypoint-initdb.d.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
