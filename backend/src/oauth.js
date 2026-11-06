import { createPkcePair, encryptRefreshToken, randomToken } from "./crypto.js";
import {
  consumeOauthState,
  createDeviceSession,
  getDriveAccountForSlot,
  saveOauthState,
  upsertDriveAccount,
  upsertOwner,
} from "./database.js";
import {
  frontendOrigin,
  HttpError,
  isAccountSlot,
  popupResultHtml,
} from "./http.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const OWNER_SCOPES = "openid email profile";
const DRIVE_SCOPES =
  "openid email profile https://www.googleapis.com/auth/drive.file";

function oauthConfig(env) {
  const clientId = String(env.GOOGLE_CLIENT_ID || "");
  const clientSecret = String(env.GOOGLE_CLIENT_SECRET || "");
  const redirectUri = String(env.OAUTH_REDIRECT_URI || "");
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth não configurado no Worker");
  }
  return { clientId, clientSecret, redirectUri };
}

function validatePublicKeyJwk(value) {
  if (
    !value ||
    value.kty !== "EC" ||
    value.crv !== "P-256" ||
    typeof value.x !== "string" ||
    typeof value.y !== "string"
  ) {
    throw new HttpError(
      400,
      "invalid_device_key",
      "Chave do dispositivo inválida",
    );
  }
  return { kty: "EC", crv: "P-256", x: value.x, y: value.y, ext: true };
}

function authorizationUrl(env, options) {
  const { clientId, redirectUri } = oauthConfig(env);
  return `${GOOGLE_AUTH_URL}?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: options.scope,
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: "S256",
    access_type: options.offline ? "offline" : "online",
    include_granted_scopes: "true",
    prompt: options.prompt,
  })}`;
}

async function createState(env, values) {
  const rawState = randomToken(32);
  const { verifier, challenge } = await createPkcePair();
  await saveOauthState(env.DB, {
    ...values,
    rawState,
    codeVerifier: verifier,
    frontendOrigin: frontendOrigin(env),
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  return { rawState, challenge };
}

export async function startOwnerAuthorization(env, body) {
  const devicePublicJwk = validatePublicKeyJwk(body.publicKeyJwk);
  const { rawState, challenge } = await createState(env, {
    purpose: "owner",
    devicePublicJwk,
  });
  return {
    authorizationUrl: authorizationUrl(env, {
      state: rawState,
      codeChallenge: challenge,
      scope: OWNER_SCOPES,
      prompt: "select_account",
      offline: false,
    }),
  };
}

export async function startDriveAuthorization(env, session, body) {
  const legacySlot = String(body.legacySlot || "").toLowerCase();
  if (!isAccountSlot(legacySlot)) {
    throw new HttpError(400, "invalid_legacy_slot", "Slot de conta inválido");
  }
  const { rawState, challenge } = await createState(env, {
    ownerId: session.owner_id,
    purpose: "drive",
    legacySlot,
    expectedEmail: String(body.expectedEmail || "")
      .trim()
      .toLowerCase(),
  });
  return {
    authorizationUrl: authorizationUrl(env, {
      state: rawState,
      codeChallenge: challenge,
      scope: DRIVE_SCOPES,
      prompt: "consent select_account",
      offline: true,
    }),
  };
}

async function exchangeAuthorizationCode(env, code, verifier) {
  const { clientId, clientSecret, redirectUri } = oauthConfig(env);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const tokens = await response.json();
  if (!response.ok || !tokens.access_token) {
    throw new HttpError(
      400,
      "oauth_exchange_failed",
      tokens.error_description || "O Google recusou a autorização",
    );
  }
  return tokens;
}

async function fetchGoogleProfile(accessToken) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = await response.json();
  if (
    !response.ok ||
    !profile.sub ||
    !profile.email ||
    profile.email_verified !== true
  ) {
    throw new HttpError(
      400,
      "profile_unavailable",
      "Conta Google não identificada",
    );
  }
  return profile;
}

function assertOwner(profile, env) {
  const expectedSub = String(env.VAULT_OWNER_GOOGLE_SUB || "").trim();
  const expectedEmail = String(env.VAULT_OWNER_EMAIL || "")
    .trim()
    .toLowerCase();
  const allowed = expectedSub
    ? profile.sub === expectedSub
    : expectedEmail && profile.email.toLowerCase() === expectedEmail;
  if (!allowed) {
    throw new HttpError(
      403,
      "owner_not_allowed",
      "Esta conta não é proprietária do VAULT",
    );
  }
}

function mapDriveAccount(account) {
  return {
    id: account.id,
    email: account.email,
    friendlyName: account.friendly_name || "",
    legacySlot: account.legacy_slot || "",
    grantedScopes: account.granted_scopes || "",
    createdAt: account.created_at,
    updatedAt: account.updated_at,
    lastTokenAt: account.last_token_at,
    revokedAt: account.revoked_at,
  };
}

async function completeOwnerCallback(env, state, tokens, profile) {
  assertOwner(profile, env);
  const owner = await upsertOwner(env.DB, profile);
  const publicKeyJwk = JSON.parse(state.device_public_jwk || "null");
  validatePublicKeyJwk(publicKeyJwk);
  const deviceSession = await createDeviceSession(
    env.DB,
    owner.id,
    publicKeyJwk,
  );
  return {
    type: "vault-auth-owner",
    payload: {
      ok: true,
      sessionId: deviceSession.sessionId,
      expiresAt: deviceSession.expiresAt,
      owner: { email: owner.email },
    },
  };
}

async function completeDriveCallback(env, state, tokens, profile) {
  if (!tokens.refresh_token) {
    throw new HttpError(
      400,
      "refresh_token_missing",
      "O Google não forneceu acesso permanente. Remova o acesso antigo do VAULT na Conta Google e tente novamente.",
    );
  }
  const expectedEmail = String(state.expected_email || "").toLowerCase();
  if (expectedEmail && profile.email.toLowerCase() !== expectedEmail) {
    throw new HttpError(
      409,
      "wrong_google_account",
      `A conta escolhida foi ${profile.email}, mas ${state.legacy_slot.toUpperCase()} está configurada como ${state.expected_email}`,
    );
  }
  const occupied = await getDriveAccountForSlot(
    env.DB,
    state.owner_id,
    state.legacy_slot,
  );
  if (occupied && occupied.google_sub !== profile.sub) {
    throw new HttpError(
      409,
      "slot_already_connected",
      `${state.legacy_slot.toUpperCase()} já está ligada a outra Conta Google`,
    );
  }
  const existing = await env.DB.prepare(
    "SELECT id FROM drive_accounts WHERE owner_id = ? AND google_sub = ?",
  )
    .bind(state.owner_id, profile.sub)
    .first();
  const accountId = existing?.id || crypto.randomUUID();
  const keyVersion = 1;
  const encrypted = await encryptRefreshToken(
    tokens.refresh_token,
    env.TOKEN_ENCRYPTION_KEY,
    { ownerId: state.owner_id, accountId, keyVersion },
  );
  const account = await upsertDriveAccount(env.DB, {
    id: accountId,
    ownerId: state.owner_id,
    googleSub: profile.sub,
    email: profile.email,
    legacySlot: state.legacy_slot,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    keyVersion,
    grantedScopes: tokens.scope || DRIVE_SCOPES,
  });
  return {
    type: "vault-auth-drive",
    payload: { ok: true, account: mapDriveAccount(account) },
  };
}

export async function completeAuthorizationCallback(request, env) {
  const url = new URL(request.url);
  const rawState = url.searchParams.get("state") || "";
  const state = await consumeOauthState(env.DB, rawState);
  const targetOrigin = state.frontend_origin || frontendOrigin(env);
  if (url.searchParams.get("error")) {
    throw Object.assign(
      new HttpError(
        400,
        "oauth_cancelled",
        url.searchParams.get("error_description") || "Autorização cancelada",
      ),
      { targetOrigin, popupType: state.purpose },
    );
  }
  try {
    const tokens = await exchangeAuthorizationCode(
      env,
      url.searchParams.get("code") || "",
      state.code_verifier,
    );
    const profile = await fetchGoogleProfile(tokens.access_token);
    const result =
      state.purpose === "owner"
        ? await completeOwnerCallback(env, state, tokens, profile)
        : await completeDriveCallback(env, state, tokens, profile);
    return popupResultHtml({
      ...result,
      targetOrigin,
    });
  } catch (error) {
    throw Object.assign(error, {
      targetOrigin,
      popupType: state.purpose,
    });
  }
}

export function popupError(error, env) {
  const type =
    error.popupType === "drive" ? "vault-auth-drive" : "vault-auth-owner";
  return popupResultHtml({
    type,
    targetOrigin: error.targetOrigin || frontendOrigin(env),
    payload: {
      ok: false,
      error: {
        code: error.code || "oauth_failed",
        message:
          error instanceof HttpError
            ? error.message
            : "Não foi possível concluir a conexão",
      },
    },
  });
}

export { mapDriveAccount };
