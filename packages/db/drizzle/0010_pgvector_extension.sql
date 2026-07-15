-- pgvector — vector similarity search (visitor face embeddings).
-- Requires the extension binaries on the server (image: pgvector/pgvector:pg16,
-- or `apt install postgresql-16-pgvector` on a bare install). CREATE EXTENSION
-- needs superuser once; IF NOT EXISTS makes this a no-op where it was
-- pre-installed manually.
CREATE EXTENSION IF NOT EXISTS vector;
