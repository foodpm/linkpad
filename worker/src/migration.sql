ALTER TABLE repositories ADD COLUMN updated_at TEXT;
UPDATE repositories SET updated_at = created_at WHERE updated_at IS NULL;

ALTER TABLE repo_follows ADD COLUMN last_viewed_at TEXT;
UPDATE repo_follows SET last_viewed_at = created_at WHERE last_viewed_at IS NULL;
