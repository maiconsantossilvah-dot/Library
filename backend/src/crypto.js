const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function base64UrlEncode(bytes) {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function base64UrlDecode(value) {
  return base64ToBytes(String(value || ""));
}

export function randomToken(byteLength = 32) {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256(value) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return base64UrlEncode(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  );
}

function encryptionKeyBytes(value) {
  const raw = String(value || "").trim();
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return Uint8Array.from(raw.match(/.{2}/g), (pair) => parseInt(pair, 16));
  }
  const bytes = base64ToBytes(raw);
  if (bytes.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY deve conter exatamente 32 bytes");
  }
  return bytes;
}

async function importEncryptionKey(value) {
  return crypto.subtle.importKey(
    "raw",
    encryptionKeyBytes(value),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

function tokenAdditionalData({ ownerId, accountId, keyVersion = 1 }) {
  return encoder.encode(`${ownerId}:${accountId}:${keyVersion}`);
}

export async function encryptRefreshToken(plaintext, keyMaterial, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importEncryptionKey(keyMaterial);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: tokenAdditionalData(context),
      tagLength: 128,
    },
    key,
    encoder.encode(plaintext),
  );
  return {
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
    iv: base64UrlEncode(iv),
  };
}

export async function decryptRefreshToken(
  ciphertext,
  iv,
  keyMaterial,
  context,
) {
  const key = await importEncryptionKey(keyMaterial);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlDecode(iv),
      additionalData: tokenAdditionalData(context),
      tagLength: 128,
    },
    key,
    base64UrlDecode(ciphertext),
  );
  return decoder.decode(plaintext);
}

export async function createPkcePair() {
  const verifier = randomToken(48);
  return { verifier, challenge: await sha256(verifier) };
}

export function signaturePayload({ method, path, bodyHash, timestamp, nonce }) {
  return [method.toUpperCase(), path, bodyHash, timestamp, nonce].join("\n");
}

export async function verifyDeviceSignature(publicKeyJwk, payload, signature) {
  const key = await crypto.subtle.importKey(
    "jwk",
    publicKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    base64UrlDecode(signature),
    encoder.encode(payload),
  );
}

export function decodeJwtPayload(token) {
  const payload = String(token || "").split(".")[1];
  if (!payload) throw new Error("ID token inválido");
  return JSON.parse(decoder.decode(base64UrlDecode(payload)));
}
