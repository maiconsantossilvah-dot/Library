export class HttpError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isAccountSlot(value) {
  return /^ac[1-9]\d{0,61}$/.test(String(value || "").toLowerCase());
}

export function frontendOrigin(env) {
  const origin = String(env.FRONTEND_ORIGIN || "").replace(/\/$/, "");
  if (!origin) throw new Error("FRONTEND_ORIGIN não configurado");
  return origin;
}

export function assertFrontendOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (origin !== frontendOrigin(env)) {
    throw new HttpError(403, "origin_not_allowed", "Origem não autorizada");
  }
  return origin;
}

export function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = frontendOrigin(env);
  return {
    ...(origin === allowed ? { "Access-Control-Allow-Origin": allowed } : {}),
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, X-Vault-Session, X-Vault-Timestamp, X-Vault-Nonce, X-Vault-Signature",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

export function json(request, env, payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(request, env),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export function noContent(request, env, status = 204) {
  return new Response(null, { status, headers: corsHeaders(request, env) });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "invalid_json", "JSON inválido");
  }
}

export function popupResultHtml({ type, payload, targetOrigin }) {
  const data = JSON.stringify({ source: "vault-auth", type, ...payload })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
  const origin = JSON.stringify(targetOrigin);
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>VAULT</title><style>body{margin:0;background:#11221b;color:#f6f1df;font:16px system-ui;display:grid;min-height:100vh;place-items:center}.card{max-width:30rem;padding:2rem;border:1px solid #42604f;border-radius:18px;background:#192a22;text-align:center}button{padding:.8rem 1rem;border:0;border-radius:10px;background:#e77752;color:white;font-weight:700}</style><div class="card"><h1>VAULT</h1><p id="status">Conexão concluída. Volte ao VAULT.</p><button type="button" onclick="window.close()">Fechar</button></div><script>const data=${data};if(window.opener){window.opener.postMessage(data,${origin})}else{document.getElementById('status').textContent='Conexão concluída. Volte ao VAULT.'}</script></html>`;
}

export function html(content, status = 200) {
  return new Response(content, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export function errorResponse(request, env, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : "internal_error";
  if (status >= 500) console.error("VAULT Worker error", error);
  return json(
    request,
    env,
    {
      error: {
        code,
        message: status >= 500 ? "Erro interno do VAULT" : error.message,
      },
    },
    status,
  );
}
