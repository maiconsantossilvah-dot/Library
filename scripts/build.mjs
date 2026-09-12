import { build } from "esbuild";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { Script } from "node:vm";
await fs.mkdir("dist/assets", { recursive: true });
const js = await build({
  entryPoints: ["app.js"],
  bundle: true,
  splitting: true,
  format: "esm",
  outdir: "dist/assets",
  entryNames: "[name]-[hash]",
  chunkNames: "chunk-[hash]",
  minify: true,
  metafile: true,
  target: ["es2022"],
  external: ["https://*"],
});
const css = await build({
  stdin: {
    contents: await fs.readFile("styles.css", "utf8"),
    loader: "css",
    resolveDir: process.cwd(),
  },
  bundle: true,
  outdir: "dist/assets",
  entryNames: "styles-[hash]",
  minify: true,
  metafile: true,
});
const script = Object.entries(js.metafile.outputs)
  .find(([, v]) => v.entryPoint === "app.js")[0]
  .replace("dist/", "");
const sheet = Object.keys(css.metafile.outputs)[0].replace("dist/", "");
const html = (await fs.readFile("index.html", "utf8"))
  .replace('src="app.js"', `src="./${script}"`)
  .replace('href="styles.css"', `href="./${sheet}"`);
await fs.writeFile("dist/index.html", html);
await fs.cp("icons", "dist/icons", { recursive: true });
await fs.copyFile("manifest.webmanifest", "dist/manifest.webmanifest");
await fs.copyFile("privacy-init.js", "dist/privacy-init.js");
const assets = [
  "privacy-init.js",
  ...Object.keys(js.metafile.outputs),
  ...Object.keys(css.metafile.outputs),
].map((p) => "./" + p.replace("dist/", ""));
const workerSource = await fs.readFile("sw.js", "utf8");
const version = createHash("sha256")
  .update(html + JSON.stringify(assets) + workerSource)
  .digest("hex")
  .slice(0, 12);
const worker = workerSource
  .replace(
    /const CACHE_NAME = "[^"]+";/,
    `const CACHE_NAME = "vault-shell-${version}";`,
  )
  .replace(
    /const SOURCE_ASSETS = \[[\s\S]*?\];/,
    `const SOURCE_ASSETS = ${JSON.stringify(assets)};`,
  );
new Script(worker, { filename: "sw.js" });
await fs.writeFile("dist/sw.js", worker);
console.log(`VAULT ${version}: static site built in dist/`);
