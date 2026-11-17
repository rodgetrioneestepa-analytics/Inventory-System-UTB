CREATE TABLE csv_uploads (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK(kind IN ('catalog','sales')),
 filename TEXT NOT NULL, chunk_count INTEGER NOT NULL CHECK(chunk_count BETWEEN 1 AND 100), expires_at TEXT NOT NULL
);
CREATE TABLE csv_upload_chunks (
 upload_id TEXT NOT NULL REFERENCES csv_uploads(id) ON DELETE CASCADE, chunk_number INTEGER NOT NULL,
 content TEXT NOT NULL, PRIMARY KEY(upload_id,chunk_number)
);
CREATE INDEX csv_upload_expiry ON csv_uploads(expires_at);
