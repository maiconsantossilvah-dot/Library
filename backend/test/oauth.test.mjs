import test from "node:test";
import assert from "node:assert/strict";
import {
  startDriveAuthorization,
  startOwnerAuthorization,
} from "../src/oauth.js";

class InsertOnlyD1 {
  constructor() {
    this.calls = [];
  }
  prepare(sql) {
    return {
      bind: (...values) => ({
        run: async () => {
          this.calls.push({ sql, values });
          return { success: true };
        },
      }),
    };
  }
}

test("login do proprietário usa PKCE e callback do Worker", async () => {
  const db = new InsertOnlyD1();
  const result = await startOwnerAuthorization(
    {
      DB: db,
      FRONTEND_ORIGIN: "https://example.github.io",
      GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "server-only",
      OAUTH_REDIRECT_URI:
        "https://vault-auth.example.workers.dev/api/oauth/callback",
    },
    {
      publicKeyJwk: {
        kty: "EC",
        crv: "P-256",
        x: "public-x",
        y: "public-y",
      },
    },
  );
  const url = new URL(result.authorizationUrl);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://vault-auth.example.workers.dev/api/oauth/callback",
  );
  assert.match(url.searchParams.get("scope"), /openid/);
  assert.equal(db.calls.length, 1);
  assert.doesNotMatch(JSON.stringify(db.calls[0].values), /server-only/);
});

test("autorização do Drive aceita contas além de Ac4", async () => {
  const db = new InsertOnlyD1();
  const result = await startDriveAuthorization(
    {
      DB: db,
      FRONTEND_ORIGIN: "https://example.github.io",
      GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "server-only",
      OAUTH_REDIRECT_URI:
        "https://vault-auth.example.workers.dev/api/oauth/callback",
    },
    { owner_id: "owner-1" },
    { legacySlot: "ac27", expectedEmail: "arquivo@example.com" },
  );

  assert.equal(
    new URL(result.authorizationUrl).origin,
    "https://accounts.google.com",
  );
  assert.equal(db.calls.length, 1);
  assert.ok(db.calls[0].values.includes("ac27"));
});
