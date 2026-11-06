import test from "node:test";
import assert from "node:assert/strict";
import {
  base64UrlEncode,
  decryptRefreshToken,
  encryptRefreshToken,
  signaturePayload,
  verifyDeviceSignature,
} from "../src/crypto.js";

test("refresh token usa AES-GCM e depende do contexto da conta", async () => {
  const key = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const context = { ownerId: "owner-1", accountId: "account-1", keyVersion: 1 };
  const encrypted = await encryptRefreshToken("refresh-secret", key, context);
  assert.notEqual(encrypted.ciphertext, "refresh-secret");
  assert.equal(
    await decryptRefreshToken(encrypted.ciphertext, encrypted.iv, key, context),
    "refresh-secret",
  );
  await assert.rejects(
    decryptRefreshToken(encrypted.ciphertext, encrypted.iv, key, {
      ...context,
      accountId: "outra-conta",
    }),
  );
});

test("assinatura ECDSA liga método, caminho, corpo, horário e nonce", async () => {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const payload = signaturePayload({
    method: "POST",
    path: "/api/drive/accounts/a/access-token",
    bodyHash: "body-hash",
    timestamp: "123",
    nonce: "nonce-1",
  });
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keys.privateKey,
      new TextEncoder().encode(payload),
    ),
  );
  assert.equal(
    await verifyDeviceSignature(
      publicKeyJwk,
      payload,
      base64UrlEncode(signature),
    ),
    true,
  );
  assert.equal(
    await verifyDeviceSignature(
      publicKeyJwk,
      payload.replace("nonce-1", "nonce-2"),
      base64UrlEncode(signature),
    ),
    false,
  );
});
