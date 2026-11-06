import {
  cleanupExpired,
  deleteDriveAccount,
  deleteSession,
  getDriveAccount,
  listDriveAccounts,
  markAccountRevoked,
  markTokenUsed,
  updateDriveAccount,
} from "./database.js";
import { decryptRefreshToken } from "./crypto.js";
import {
  assertFrontendOrigin,
  errorResponse,
  frontendOrigin,
  html,
  HttpError,
  isAccountSlot,
  json,
  noContent,
  readJson,
} from "./http.js";
import {
  completeAuthorizationCallback,
  mapDriveAccount,
  popupError,
  startDriveAuthorization,
  startOwnerAuthorization,
} from "./oauth.js";
import { requireDeviceSession } from "./session.js";

function accountRoute(pathname) {
  const match = pathname.match(
    /^\/api\/drive\/accounts\/([^/]+)(?:\/(access-token))?$/,
  );
  return match
    ? { id: decodeURIComponent(match[1]), action: match[2] || "" }
    : null;
}

async function refreshAccessToken(env, account) {
  const refreshToken = await decryptRefreshToken(
    account.refresh_token_ciphertext,
    account.refresh_token_iv,
    env.TOKEN_ENCRYPTION_KEY,
    {
      ownerId: account.owner_id,
      accountId: account.id,
      keyVersion: account.encryption_key_version,
    },
  );
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    if (payload.error === "invalid_grant") {
      await markAccountRevoked(env.DB, account.owner_id, account.id);
      throw new HttpError(
        409,
        "reconnect_required",
        "O Google revogou esta conexão. Reconecte a conta.",
      );
    }
    throw new HttpError(
      502,
      "google_token_failed",
      "Não foi possível renovar o acesso ao Google Drive",
    );
  }
  await markTokenUsed(env.DB, account.owner_id, account.id);
  return {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000,
    scope: payload.scope || account.granted_scopes,
  };
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (request.method === "OPTIONS") {
    assertFrontendOrigin(request, env);
    return noContent(request, env);
  }

  if (pathname === "/api/health" && request.method === "GET") {
    return json(request, env, { ok: true, service: "vault-auth" });
  }

  if (pathname === "/api/auth/owner/start" && request.method === "POST") {
    assertFrontendOrigin(request, env);
    return json(
      request,
      env,
      await startOwnerAuthorization(env, await readJson(request)),
    );
  }

  if (pathname === "/api/oauth/callback" && request.method === "GET") {
    try {
      return html(await completeAuthorizationCallback(request, env));
    } catch (error) {
      return html(popupError(error, env), error.status || 400);
    }
  }

  const session = await requireDeviceSession(request, env);

  if (pathname === "/api/session" && request.method === "GET") {
    return json(request, env, {
      authenticated: true,
      owner: { email: session.owner_email },
      expiresAt: session.expires_at,
    });
  }
  if (pathname === "/api/session/logout" && request.method === "POST") {
    await deleteSession(env.DB, session.id_hash);
    return noContent(request, env);
  }
  if (pathname === "/api/drive/accounts" && request.method === "GET") {
    const accounts = await listDriveAccounts(env.DB, session.owner_id);
    return json(request, env, { accounts: accounts.map(mapDriveAccount) });
  }
  if (pathname === "/api/drive/accounts/connect" && request.method === "POST") {
    return json(
      request,
      env,
      await startDriveAuthorization(env, session, await readJson(request)),
    );
  }

  const route = accountRoute(pathname);
  if (!route) throw new HttpError(404, "not_found", "Endpoint não encontrado");
  const account = await getDriveAccount(env.DB, session.owner_id, route.id);
  if (!account)
    throw new HttpError(404, "account_not_found", "Conta não encontrada");

  if (route.action === "access-token" && request.method === "POST") {
    if (account.revoked_at) {
      throw new HttpError(
        409,
        "reconnect_required",
        "Reconecte esta Conta Google",
      );
    }
    return json(request, env, await refreshAccessToken(env, account));
  }
  if (!route.action && request.method === "PATCH") {
    const body = await readJson(request);
    const legacySlot = String(body.legacySlot || "").toLowerCase();
    if (!isAccountSlot(legacySlot)) {
      throw new HttpError(400, "invalid_legacy_slot", "Slot inválido");
    }
    const updated = await updateDriveAccount(
      env.DB,
      session.owner_id,
      route.id,
      {
        friendlyName: String(body.friendlyName || "")
          .trim()
          .slice(0, 80),
        legacySlot,
      },
    );
    return json(request, env, { account: mapDriveAccount(updated) });
  }
  if (!route.action && request.method === "DELETE") {
    try {
      const refreshToken = await decryptRefreshToken(
        account.refresh_token_ciphertext,
        account.refresh_token_iv,
        env.TOKEN_ENCRYPTION_KEY,
        {
          ownerId: account.owner_id,
          accountId: account.id,
          keyVersion: account.encryption_key_version,
        },
      );
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken }),
      });
    } catch (error) {
      console.warn(
        "Não foi possível revogar o token no Google",
        error?.message,
      );
    }
    await deleteDriveAccount(env.DB, session.owner_id, account.id);
    return noContent(request, env);
  }
  throw new HttpError(405, "method_not_allowed", "Método não permitido");
}

export async function handleRequest(request, env) {
  try {
    if (!env.DB) throw new Error("Binding DB não configurado");
    if (Math.random() < 0.02) await cleanupExpired(env.DB);
    return await handleApi(request, env);
  } catch (error) {
    return errorResponse(request, env, error);
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
