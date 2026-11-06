import { sha256, signaturePayload, verifyDeviceSignature } from "./crypto.js";
import { getSession, rememberNonce, touchSession } from "./database.js";
import { assertFrontendOrigin, HttpError } from "./http.js";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export async function requireDeviceSession(request, env) {
  assertFrontendOrigin(request, env);
  const sessionId = request.headers.get("X-Vault-Session") || "";
  const timestamp = request.headers.get("X-Vault-Timestamp") || "";
  const nonce = request.headers.get("X-Vault-Nonce") || "";
  const signature = request.headers.get("X-Vault-Signature") || "";
  const timestampNumber = Number(timestamp);
  if (
    !sessionId ||
    !nonce ||
    !signature ||
    !Number.isFinite(timestampNumber) ||
    Math.abs(Date.now() - timestampNumber) > MAX_CLOCK_SKEW_MS
  ) {
    throw new HttpError(401, "invalid_session_proof", "Sessão inválida");
  }

  const session = await getSession(env.DB, sessionId);
  if (!session) throw new HttpError(401, "session_expired", "Sessão expirada");

  const url = new URL(request.url);
  const body = new Uint8Array(await request.clone().arrayBuffer());
  const payload = signaturePayload({
    method: request.method,
    path: `${url.pathname}${url.search}`,
    bodyHash: await sha256(body),
    timestamp,
    nonce,
  });
  let valid = false;
  try {
    valid = await verifyDeviceSignature(
      JSON.parse(session.public_key_jwk),
      payload,
      signature,
    );
  } catch {
    valid = false;
  }
  if (!valid)
    throw new HttpError(401, "invalid_session_proof", "Assinatura inválida");

  await rememberNonce(env.DB, session.id_hash, nonce);
  await touchSession(env.DB, session.id_hash);
  return session;
}
