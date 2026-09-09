import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { JSDOM } from "jsdom";
import axe from "axe-core";
test("HTML não repete IDs e todos os rótulos apontam para controles existentes", async () => {
  const document = new JSDOM(await fs.readFile("index.html", "utf8")).window
    .document;
  const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const label of document.querySelectorAll("label[for]"))
    assert.ok(document.getElementById(label.htmlFor), label.outerHTML);
  assert.ok(document.querySelector("a.skip-link"));
  for (const name of ["navHome", "navFiles", "navPhotos", "navMural"])
    assert.equal(document.getElementById(name).tagName, "BUTTON");
});
test("axe: estrutura estática WCAG A/AA (contraste exige navegador real)", async () => {
  const dom = new JSDOM(await fs.readFile("index.html", "utf8"), {
    runScripts: "outside-only",
  });
  dom.window.eval(axe.source);
  const report = await dom.window.axe.run(dom.window.document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    rules: { "color-contrast": { enabled: false } },
  });
  assert.equal(
    report.violations.length,
    0,
    JSON.stringify(
      report.violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
    ),
  );
  dom.window.close();
});
