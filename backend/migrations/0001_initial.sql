PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS owners (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  public_key_jwk TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_owner_idx ON sessions(owner_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS session_nonces (
  session_id_hash TEXT NOT NULL REFERENCES sessions(id_hash) ON DELETE CASCADE,
  nonce_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (session_id_hash, nonce_hash)
);

CREATE INDEX IF NOT EXISTS session_nonces_expiry_idx ON session_nonces(expires_at);

CREATE TABLE IF NOT EXISTS drive_accounts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  google_sub TEXT NOT NULL,
  email TEXT NOT NULL,
  friendly_name TEXT,
  legacy_slot TEXT,
  refresh_token_ciphertext TEXT NOT NULL,
  refresh_token_iv TEXT NOT NULL,
  encryption_key_version INTEGER NOT NULL DEFAULT 1,
  granted_scopes TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_token_at INTEGER,
  revoked_at INTEGER,
  UNIQUE (owner_id, google_sub),
  UNIQUE (owner_id, legacy_slot)
);

CREATE INDEX IF NOT EXISTS drive_accounts_owner_idx ON drive_accounts(owner_id);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES owners(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  legacy_slot TEXT,
  expected_email TEXT,
  frontend_origin TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  device_public_jwk TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS oauth_states_expiry_idx ON oauth_states(expires_at);
