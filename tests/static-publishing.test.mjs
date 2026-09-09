import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { build } from "esbuild";

test("raiz publicada: todos os imports resolvem no navegador, sem npm ou build", async () => {
  const files = [
    "app.js",
    "vendor/lucide.js",
    ...(await fs.readdir("modules"))
      .filter((file) => file.endsWith(".js"))
      .map((file) => `modules/${file}`),
  ];
  // Parse without bundling: Node's own imports would silently resolve npm
  // packages and miss the browser regression this test protects against.
  const { metafile } = await build({
    entryPoints: files,
    bundle: false,
    write: false,
    metafile: true,
    outdir: "unused-test-output",
    logLevel: "silent",
  });
  let importsChecked = 0;
  for (const output of Object.values(metafile.outputs)) {
    const file = output.entryPoint;
    for (const dependency of output.imports) {
      importsChecked++;
      const specifier = dependency.path;
      if (/^https?:\/\//.test(specifier)) continue;
      assert.match(specifier, /^\.\.?\//, `${file}: bare import ${specifier}`);
      await fs.access(path.resolve(path.dirname(file), specifier));
    }
  }
  assert.ok(
    importsChecked > 20,
    "must actually inspect emitted browser imports",
  );
  const context = vm.createContext({ self: { addEventListener() {} } });
  vm.runInContext(await fs.readFile("sw.js", "utf8"), context);
  const shell = vm.runInContext("APP_SHELL", context);
  for (const file of files)
    assert.ok(shell.includes(`./${file}`), `${file} cached offline`);
  for (const asset of shell) await fs.access(asset);
});

test("service worker da raiz: fonte atualizada pela rede e fallback offline", async () => {
  const handlers = {};
  const cached = { cached: true };
  const fresh = { ok: true, clone: () => fresh };
  const stored = [];
  let offline = false;
  const context = vm.createContext({
    URL,
    self: {
      location: { origin: "https://vault.test" },
      registration: { scope: "https://vault.test/Library/" },
      addEventListener: (name, handler) => (handlers[name] = handler),
    },
    caches: {
      open: async () => ({
        match: async () => cached,
        put: async (request) => stored.push(request.url),
      }),
    },
    fetch: async () => {
      if (offline) throw new Error("offline");
      return fresh;
    },
  });
  vm.runInContext(await fs.readFile("sw.js", "utf8"), context);
  const request = {
    method: "GET",
    url: "https://vault.test/Library/vendor/lucide.js",
  };
  let result;
  handlers.fetch({ request, respondWith: (promise) => (result = promise) });
  assert.equal(await result, fresh);
  assert.deepEqual(stored, [request.url]);
  offline = true;
  handlers.fetch({ request, respondWith: (promise) => (result = promise) });
  assert.equal(await result, cached);
  for (const url of [
    "https://www.googleapis.com/drive/v3/files",
    "https://vault.test/private.jpg",
  ]) {
    handlers.fetch({
      request: { method: "GET", url },
      respondWith: () =>
        assert.fail("must not cache user files or external APIs"),
    });
  }
});
