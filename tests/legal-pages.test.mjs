import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { JSDOM } from "jsdom";

const pages = ["privacy.html", "terms.html"];

test("páginas legais são públicas, navegáveis e ligadas ao VAULT", async () => {
  const index = await fs.readFile("index.html", "utf8");
  assert.match(index, /href="privacy\.html"/);
  assert.match(index, /href="terms\.html"/);

  for (const page of pages) {
    const html = await fs.readFile(page, "utf8");
    const dom = new JSDOM(html);
    const document = dom.window.document;
    assert.equal(document.documentElement.lang, "pt-BR");
    assert.ok(document.querySelector('link[rel="canonical"]')?.href);
    assert.ok(document.querySelector('a[href="./"]'));
    assert.ok(document.querySelector('a[href="privacy.html"]'));
    assert.ok(document.querySelector('a[href="terms.html"]'));
    assert.equal(
      new Set([...document.querySelectorAll("[id]")].map((node) => node.id))
        .size,
      document.querySelectorAll("[id]").length,
    );
  }
});

test("política explica dados do Google, proteção, retenção e revogação", async () => {
  const privacy = await fs.readFile("privacy.html", "utf8");
  assert.match(privacy, /drive\.file/);
  assert.match(privacy, /AES-GCM/);
  assert.match(privacy, /Uso Limitado/);
  assert.match(privacy, /revogar/i);
  assert.match(privacy, /retenção/i);
  assert.match(privacy, /mailto:maiconsantossilvah@gmail\.com/);
});
