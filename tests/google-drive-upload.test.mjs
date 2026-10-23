import test from "node:test";
import assert from "node:assert/strict";
import { GoogleDriveManager } from "../modules/google-drive.js";

function connectedManager(onSessionInvalid) {
  const manager = new GoogleDriveManager({ onSessionInvalid });
  manager.sessions.set("ac1", {
    accessToken: "test-token",
    expiresAt: Date.now() + 3_600_000,
  });
  return manager;
}

function mockXhr(status = 200, response = { id: "drive-file" }) {
  const original = globalThis.XMLHttpRequest;
  const requests = [];
  globalThis.XMLHttpRequest = class {
    constructor() {
      this.headers = {};
      this.upload = {};
      requests.push(this);
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name, value) {
      this.headers[name] = value;
    }
    send(body) {
      this.body = body;
      queueMicrotask(() => {
        this.status = status;
        this.responseText = JSON.stringify(
          status >= 200 && status < 300 && response.size === undefined
            ? { ...response, size: String(body.size) }
            : response,
        );
        this.upload.onprogress?.({
          lengthComputable: true,
          loaded: body.size,
          total: body.size,
        });
        this.onload();
      });
    }
  };
  return {
    requests,
    restore: () => (globalThis.XMLHttpRequest = original),
  };
}

test("arquivo pequeno envia os bytes por sessão retomável", async () => {
  const originalFetch = globalThis.fetch;
  const xhr = mockXhr();
  let initiation;
  globalThis.fetch = async (url, options) => {
    initiation = { url, options };
    return new Response(null, {
      status: 200,
      headers: { location: "https://upload.example/session" },
    });
  };
  try {
    const manager = connectedManager();
    const file = new Blob(["imagem de teste"], { type: "image/png" });
    file.name = "pagina.png";
    const progress = [];
    const saved = await manager.uploadFile("ac1", file, "pasta", {
      onProgress: (loaded, total) => progress.push([loaded, total]),
    });
    assert.equal(saved.id, "drive-file");
    assert.equal(xhr.requests.length, 1);
    assert.match(initiation.url, /uploadType=resumable/);
    assert.deepEqual(JSON.parse(initiation.options.body), {
      name: "pagina.png",
      mimeType: "image/png",
      parents: ["pasta"],
    });
    const request = xhr.requests[0];
    assert.equal(request.method, "PUT");
    assert.equal(request.body, file);
    assert.equal(await request.body.text(), "imagem de teste");
    assert.deepEqual(progress, [[file.size, file.size]]);
  } finally {
    globalThis.fetch = originalFetch;
    xhr.restore();
  }
});

test("arquivos grandes continuam com sessão resumível", async () => {
  const originalFetch = globalThis.fetch;
  const xhr = mockXhr();
  let initiation;
  globalThis.fetch = async (url, options) => {
    initiation = { url, options };
    return new Response(null, {
      status: 200,
      headers: { location: "https://upload.example/session" },
    });
  };
  try {
    const manager = connectedManager();
    const file = new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]);
    file.name = "grande.bin";
    const saved = await manager.uploadFile("ac1", file, "pasta");
    assert.equal(saved.id, "drive-file");
    assert.match(initiation.url, /uploadType=resumable/);
    assert.deepEqual(JSON.parse(initiation.options.body), {
      name: "grande.bin",
      mimeType: "application/octet-stream",
      parents: ["pasta"],
    });
    assert.equal(
      initiation.options.headers["X-Upload-Content-Length"],
      undefined,
    );
    assert.equal(xhr.requests[0].method, "PUT");
    assert.equal(xhr.requests[0].url, "https://upload.example/session");
    assert.equal(xhr.requests[0].body, file);
  } finally {
    globalThis.fetch = originalFetch;
    xhr.restore();
  }
});

test("falha de rede ao abrir sessão mostra orientação, sem erro bruto", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  try {
    const file = new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]);
    file.name = "grande.bin";
    await assert.rejects(
      connectedManager().uploadFile("ac1", file, "pasta"),
      /Verifique a conexão ou algum bloqueio a www\.googleapis\.com/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("arquivo vazio é recusado antes de criar um item no Drive", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("não deveria acessar o Drive");
  };
  try {
    const file = new Blob([], { type: "image/jpeg" });
    file.name = "pagina.jpg";
    await assert.rejects(
      connectedManager().uploadFile("ac1", file, "pasta"),
      /arquivo está vazio \(0 B\)/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tamanho diferente no Drive impede sucesso falso", async () => {
  const originalFetch = globalThis.fetch;
  const xhr = mockXhr(200, { id: "drive-file", size: "0" });
  globalThis.fetch = async (url) => {
    if (url.includes("uploadType=resumable"))
      return new Response(null, {
        status: 200,
        headers: { location: "https://upload.example/session" },
      });
    return new Response(JSON.stringify({ id: "drive-file", size: "0" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const file = new Blob(["conteúdo"], { type: "image/jpeg" });
    file.name = "pagina.jpg";
    await assert.rejects(
      connectedManager().uploadFile("ac1", file, "pasta"),
      /O Drive recebeu 0 B de 9 B/,
    );
    assert.equal(xhr.requests[0].body, file);
  } finally {
    globalThis.fetch = originalFetch;
    xhr.restore();
  }
});

test("resposta 401 na transferência invalida a sessão", async () => {
  const originalFetch = globalThis.fetch;
  const xhr = mockXhr(401, { error: { message: "Token expirado" } });
  globalThis.fetch = async () =>
    new Response(null, {
      status: 200,
      headers: { location: "https://upload.example/session" },
    });
  let invalidated = false;
  try {
    const manager = connectedManager(() => (invalidated = true));
    const file = new Blob(["arquivo"]);
    file.name = "arquivo.txt";
    await assert.rejects(
      manager.uploadFile("ac1", file, "pasta"),
      /Token expirado/,
    );
    assert.equal(invalidated, true);
    assert.equal(manager.sessions.has("ac1"), false);
  } finally {
    globalThis.fetch = originalFetch;
    xhr.restore();
  }
});
