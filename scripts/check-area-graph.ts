import assert from "node:assert/strict";
import { buildAreaGraph, layoutAreaGraph } from "../src/area-graph.ts";

const graph = buildAreaGraph(
  [
    { name: "Life", parent: null },
    { name: "Leisure", parent: null },
    { name: "Home", parent: "Life" },
    { name: "Garden", parent: "Home" },
    { name: "Music", parent: "Leisure" },
    { name: "A", parent: "B" },
    { name: "B", parent: "A" },
    { name: "Orphan", parent: "Missing" },
  ],
  [["Music"], ["Music", "Home"], ["Music", "Home", "Music"], ["Home", "Nope"], ["Garden"], []],
);

const byName = new Map(graph.areas.map((a) => [a.name, a]));
assert.equal(byName.get("Music")?.count, 3);
assert.equal(byName.get("Home")?.count, 3);
assert.equal(byName.get("Life")?.count, 0);
assert.equal(byName.get("Orphan")?.parent, null);
assert.equal(byName.get("A")?.parent, null);
assert.equal(graph.shared.get("Music")?.get("Home"), 2);
assert.equal(graph.shared.get("Home")?.get("Music"), 2);

const circles = layoutAreaGraph(graph);
const container = (n: string) => circles.find((c) => c.name === n && c.container)!;
const area = (n: string) => circles.find((c) => c.name === n && !c.container)!;
const inside = (inner: { x: number; y: number; radius: number }, outer: typeof inner) =>
  Math.hypot(inner.x - outer.x, inner.y - outer.y) + inner.radius <= outer.radius + 1e-6;

for (const c of circles) assert.ok(Number.isFinite(c.x) && Number.isFinite(c.radius), c.name);
assert.ok(inside(area("Home"), container("Home")));
assert.ok(inside(container("Home"), container("Life")));
assert.ok(inside(area("Garden"), container("Home")));
assert.ok(inside(area("Music"), container("Leisure")));
assert.equal(circles.filter((c) => c.name === "Life" && !c.container).length, 0);

const life = container("Life");
const leisure = container("Leisure");
assert.ok(Math.hypot(life.x - leisure.x, life.y - leisure.y) >= life.radius + leisure.radius);

console.log("area-graph ok");
