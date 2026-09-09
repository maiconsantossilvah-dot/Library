import test from "node:test";
import assert from "node:assert/strict";
import { geometry, fitView, connectorPath } from "../modules/board-model.js";
test("geometria limita tamanhos e posições inválidos", () => {
  assert.deepEqual(geometry({ x: -99999, y: 99999, width: 0, height: 99999 }), {
    x: -20000,
    y: 20000,
    width: 160,
    height: 1200,
  });
});
test("conexão liga centros dos itens", () => {
  assert.equal(
    connectorPath(
      { x: 0, y: 0, width: 200, height: 200 },
      { x: 400, y: 200, width: 200, height: 200 },
    ),
    "M 100 100 L 500 300",
  );
});
test("enquadramento mantém elementos dentro do viewport", () => {
  const items = [
    { x: -100, y: 200, width: 200, height: 300 },
    { x: 500, y: 300, width: 200, height: 200 },
  ];
  const v = fitView(items, 800, 600);
  assert.ok(v.zoom >= 0.2 && v.zoom <= 2);
  for (const item of items) {
    assert.ok(item.x * v.zoom + v.x >= 0);
    assert.ok((item.x + item.width) * v.zoom + v.x <= 800);
  }
});
