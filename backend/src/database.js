import { randomToken, sha256 } from "./crypto.js";
import { HttpError } from "./http.js";

function now() {
  return Date.now();
}

export async function cleanupExpired(db) {
  const current = now();
  await db.batch([
    db.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").bind(current),
    db
      .prepare("DELETE FROM session_nonces WHERE expires_at <= ?")
      .bind(current),
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(current),
  ]);
}

export async function saveOauthState(db, state) {
  await db
    .prepare(
      `INSERT INTO oauth_states
       (state_hash, owner_id, purpose, legacy_slot, expected_email, frontend_origin, code_verifier, device_public_jwk, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      await sha256(state.rawState),
      state.ownerId || null,
      state.purpose,
      state.legacySlot || null,
      state.expectedEmail || null,
      state.frontendOrigin,
      state.codeVerifier,
      state.devicePublicJwk ? JSON.stringify(state.devicePublicJwk) : null,
      state.expiresAt,
      now(),
    )
    .run();
}

export async function consumeOauthState(db, rawState) {
  const stateHash = await sha256(rawState);
  const state = await db
    .prepare(
      "SELECT * FROM oauth_states WHERE state_hash = ? AND expires_at > ?",
    )
    .bind(stateHash, now())
    .first();
  if (!state) throw new HttpError(400, "invalid_state", "Autorização expirada");
  await db
    .prepare("DELETE FROM oauth_states WHERE state_hash = ?")
    .bind(stateHash)
    .run();
  return state;
}

export async function upsertOwner(db, profile) {
  const existing = await db
    .prepare("SELECT * FROM owners WHERE google_sub = ?")
    .bind(profile.sub)
    .first();
  const id = existing?.id || crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO owners (id, google_sub, email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at`,
    )
    .bind(id, profile.sub, profile.email, existing?.created_at || now(), now())
    .run();
  return { id, googleSub: profile.sub, email: profile.email };
}

export async function createDeviceSession(db, ownerId, publicKeyJwk) {
  const sessionId = randomToken(32);
  const idHash = await sha256(sessionId);
  const createdAt = now();
  const expiresAt = createdAt + 30 * 24 * 60 * 60 * 1000;
  await db
    .prepare(
      `INSERT INTO sessions
       (id_hash, owner_id, public_key_jwk, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      idHash,
      ownerId,
      JSON.stringify(publicKeyJwk),
      expiresAt,
      createdAt,
      createdAt,
    )
    .run();
  return { sessionId, expiresAt };
}

export async function getSession(db, sessionId) {
  if (!sessionId) return null;
  return db
    .prepare(
      `SELECT sessions.*, owners.email AS owner_email, owners.google_sub AS owner_google_sub
       FROM sessions JOIN owners ON owners.id = sessions.owner_id
       WHERE sessions.id_hash = ? AND sessions.expires_at > ?`,
    )
    .bind(await sha256(sessionId), now())
    .first();
}

export async function rememberNonce(db, sessionHash, nonce) {
  try {
    await db
      .prepare(
        "INSERT INTO session_nonces (session_id_hash, nonce_hash, expires_at) VALUES (?, ?, ?)",
      )
      .bind(sessionHash, await sha256(nonce), now() + 10 * 60 * 1000)
      .run();
  } catch {
    throw new HttpError(401, "replayed_request", "Requisição já utilizada");
  }
}

export async function touchSession(db, sessionHash) {
  await db
    .prepare("UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?")
    .bind(now(), sessionHash)
    .run();
}

export async function deleteSession(db, sessionHash) {
  await db.batch([
    db
      .prepare("DELETE FROM session_nonces WHERE session_id_hash = ?")
      .bind(sessionHash),
    db.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(sessionHash),
  ]);
}

export async function listDriveAccounts(db, ownerId) {
  const result = await db
    .prepare(
      `SELECT id, google_sub, email, friendly_name, legacy_slot, granted_scopes,
              created_at, updated_at, last_token_at, revoked_at
       FROM drive_accounts WHERE owner_id = ? ORDER BY created_at ASC`,
    )
    .bind(ownerId)
    .all();
  return result.results || [];
}

export async function getDriveAccount(db, ownerId, accountId) {
  return db
    .prepare("SELECT * FROM drive_accounts WHERE owner_id = ? AND id = ?")
    .bind(ownerId, accountId)
    .first();
}

export async function getDriveAccountForSlot(db, ownerId, legacySlot) {
  return db
    .prepare(
      "SELECT * FROM drive_accounts WHERE owner_id = ? AND legacy_slot = ? AND revoked_at IS NULL",
    )
    .bind(ownerId, legacySlot)
    .first();
}

export async function upsertDriveAccount(db, account) {
  const existing = await db
    .prepare(
      "SELECT * FROM drive_accounts WHERE owner_id = ? AND google_sub = ?",
    )
    .bind(account.ownerId, account.googleSub)
    .first();
  const id = existing?.id || account.id;
  await db
    .prepare(
      `INSERT INTO drive_accounts
       (id, owner_id, google_sub, email, friendly_name, legacy_slot,
        refresh_token_ciphertext, refresh_token_iv, encryption_key_version,
        granted_scopes, created_at, updated_at, last_token_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(owner_id, google_sub) DO UPDATE SET
         email = excluded.email,
         friendly_name = COALESCE(excluded.friendly_name, drive_accounts.friendly_name),
         legacy_slot = excluded.legacy_slot,
         refresh_token_ciphertext = excluded.refresh_token_ciphertext,
         refresh_token_iv = excluded.refresh_token_iv,
         encryption_key_version = excluded.encryption_key_version,
         granted_scopes = excluded.granted_scopes,
         updated_at = excluded.updated_at,
         revoked_at = NULL`,
    )
    .bind(
      id,
      account.ownerId,
      account.googleSub,
      account.email,
      account.friendlyName || null,
      account.legacySlot,
      account.ciphertext,
      account.iv,
      account.keyVersion,
      account.grantedScopes,
      existing?.created_at || now(),
      now(),
      now(),
    )
    .run();
  return getDriveAccount(db, account.ownerId, id);
}

export async function updateDriveAccount(db, ownerId, accountId, changes) {
  await db
    .prepare(
      `UPDATE drive_accounts SET friendly_name = ?, legacy_slot = ?, updated_at = ?
       WHERE owner_id = ? AND id = ?`,
    )
    .bind(
      changes.friendlyName || null,
      changes.legacySlot || null,
      now(),
      ownerId,
      accountId,
    )
    .run();
  return getDriveAccount(db, ownerId, accountId);
}

export async function markTokenUsed(db, ownerId, accountId) {
  await db
    .prepare(
      "UPDATE drive_accounts SET last_token_at = ?, updated_at = ? WHERE owner_id = ? AND id = ?",
    )
    .bind(now(), now(), ownerId, accountId)
    .run();
}

export async function markAccountRevoked(db, ownerId, accountId) {
  await db
    .prepare(
      "UPDATE drive_accounts SET revoked_at = ?, updated_at = ? WHERE owner_id = ? AND id = ?",
    )
    .bind(now(), now(), ownerId, accountId)
    .run();
}

export async function deleteDriveAccount(db, ownerId, accountId) {
  await db
    .prepare("DELETE FROM drive_accounts WHERE owner_id = ? AND id = ?")
    .bind(ownerId, accountId)
    .run();
}
