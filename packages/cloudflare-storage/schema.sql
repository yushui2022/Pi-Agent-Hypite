-- Workers deployment schema.
-- Account tables mirror the local SQLite schema in packages/saas/store.mjs field for
-- field so that a migration is a 1:1 copy instead of a rewrite. Do not add columns
-- here that the local schema does not have; a migration would have to invent values.
--
-- Media is not stored in D1. Asset bytes live in R2 under
--   workspaces/<workspaceId>/projects/<projectId>/assets/<assetId>
-- with the workspace prefix included so tenant isolation does not depend on query code.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  user_id TEXT NOT NULL REFERENCES users(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  role TEXT NOT NULL,
  PRIMARY KEY (user_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  expires_at INTEGER NOT NULL
);

-- Local `projects` maps here. The table keeps its existing name because
-- packages/cloudflare-storage/d1.ts reads it; `revision` is the project document
-- hash used for optimistic concurrency, stored so a save is one statement.
CREATE TABLE IF NOT EXISTS remix_projects (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  document TEXT NOT NULL CHECK(json_valid(document)),
  revision TEXT NOT NULL CHECK(length(revision) = 64)
);

CREATE INDEX IF NOT EXISTS projects_workspace ON remix_projects(workspace_id);
CREATE INDEX IF NOT EXISTS memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

-- Pending direct uploads. A row exists only between "the browser asked for a signed URL"
-- and "the server verified what actually landed in R2". Nothing here is user-trusted:
-- state moves to complete only after a HEAD comparison of size and native checksum.
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size > 0),
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
  state TEXT NOT NULL CHECK(state IN ('pending','complete','failed')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS uploads_workspace ON uploads(workspace_id, state);
CREATE INDEX IF NOT EXISTS uploads_expiry ON uploads(expires_at);
