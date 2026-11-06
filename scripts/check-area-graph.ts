import assert from "node:assert/strict";
import {
  buildAreaGraph,
  distanceForOverlap,
  enclose,
  intersectionArea,
  labelFits,
  labelPx,
  layoutAreaGraph,
  placeLabels,
} from "../src/area-graph.ts";

const inputs = [
  { name: "Life", parent: null },
  { name: "Leisure", parent: null },
  { name: "Home", parent: "Life" },
  { name: "Garden", parent: "Home" },
  { name: "Car", parent: "Life" },
  { name: "Music", parent: "Leisure" },
  { name: "Movies", parent: "Leisure" },
  { name: "A", parent: "B" },
  { name: "B", parent: "A" },
  { name: "Orphan", parent: "Missing" },
];
const graph = buildAreaGraph(inputs, [
  ...Array(20).fill(["Music"]),
  ...Array(6).fill(["Music", "Home"]),
  ["Music", "Home", "Music"],
  ...Array(10).fill(["Home"]),
  ["Home", "Nope"],
  ...Array(4).fill(["Garden"]),
  ...Array(5).fill(["Car"]),
  ...Array(3).fill(["Movies"]),
  ["Movies", "Garden"],
  ["Life"],
  [],
]);

const byName = new Map(graph.areas.map((a) => [a.name, a]));
assert.equal(byName.get("Music")?.count, 27);
assert.equal(byName.get("Home")?.count, 18);
assert.equal(byName.get("Garden")?.root, "Life");
assert.equal(byName.get("Orphan")?.parent, null);
assert.equal(byName.get("A")?.parent, null);
assert.equal(graph.shared.get("Music")?.get("Home"), 7);

const r1 = 30;
const r2 = 20;
assert.ok(Math.abs(intersectionArea(r1, r2, distanceForOverlap(r1, r2, 400)) - 400) < 1e-6);
assert.equal(intersectionArea(r1, r2, r1 + r2), 0);
assert.equal(intersectionArea(r1, r2, 5), Math.PI * r2 * r2);

const ring = enclose([
  { x: -10, y: 0, radius: 5 },
  { x: 10, y: 0, radius: 5 },
  { x: 0, y: 3, radius: 1 },
]);
assert.ok(Math.abs(ring.cx) < 0.5 && Math.abs(ring.cy) < 0.5 && Math.abs(ring.radius - 15) < 0.5, "tight enclosing circle");

const { circles, overlaps } = layoutAreaGraph(graph);
for (const c of circles) assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y), c.name);

const container = (n: string) => circles.find((c) => c.name === n && c.container)!;
const area = (n: string) => circles.find((c) => c.name === n && !c.container)!;
const inside = (inner: { x: number; y: number; radius: number }, outer: typeof inner) =>
  Math.hypot(inner.x - outer.x, inner.y - outer.y) + inner.radius <= outer.radius + 1e-6;

assert.ok(container("Life") && container("Home") && container("Leisure"));
assert.ok(!area("Life") && !area("Home"), "a parent is only its container");
assert.equal(container("Home").own, 18);
assert.ok(
  container("Home").radius > Math.hypot(area("Garden").radius + 14, 4 * Math.sqrt(18)) - 1e-6,
  "a container makes room for its own notes",
);
assert.ok(inside(container("Home"), container("Life")));
assert.ok(inside(area("Garden"), container("Home")));
assert.ok(inside(area("Garden"), container("Life")));
assert.ok(inside(area("Car"), container("Life")));
assert.ok(inside(area("Music"), container("Leisure")));
assert.ok(inside(area("Movies"), container("Leisure")));

const roots = overlaps.find((o) => [o.a.name, o.b.name].sort().join() === "Leisure,Life");
assert.ok(roots, "Life and Leisure overlap because their subtrees share notes");
assert.equal(roots.shared, 8);
assert.ok(!overlaps.some((o) => o.shared < 3), "pairs under the threshold are not drawn");

const leaves = circles.filter((c) => !c.container);
for (let i = 0; i < leaves.length; i++) {
  for (let j = i + 1; j < leaves.length; j++) {
    const a = leaves[i];
    const b = leaves[j];
    if ((graph.shared.get(a.name)?.get(b.name) ?? 0) >= 3 && a.root === b.root) continue;
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.radius + b.radius - 1, `${a.name} and ${b.name} do not overlap`);
  }
}

console.log("area-graph ok");

assert.equal(labelPx(1), 11);
assert.equal(labelPx(1000), 22);
assert.ok(labelFits(0.6, 40), "a 6-char label fits a 40px circle");
assert.ok(!labelFits(0.6 * 4, 10), "a long label hides in a 10px circle");
console.log("labels ok");

const box = (x: number, y: number) => ({ x, y, width: 10, height: 4 });
assert.deepEqual(placeLabels([box(0, 0), box(5, 2), null, box(0, 8), box(0, 5)], 2), [true, false, false, true, false]);
console.log("label placement ok");
