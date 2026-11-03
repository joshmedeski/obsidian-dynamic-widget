import {
  type Force,
  forceLink,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

export interface AreaInput {
  name: string;
  parent: string | null;
}

export interface GraphArea {
  name: string;
  parent: string | null;
  root: string;
  count: number;
}

export interface AreaGraph {
  areas: GraphArea[];
  shared: Map<string, Map<string, number>>;
  notesOf: Map<string, Set<number>>;
}

export interface Circle {
  name: string;
  root: string;
  container: boolean;
  depth: number;
  count: number;
  x: number;
  y: number;
  radius: number;
}

export interface Overlap {
  a: Circle;
  b: Circle;
  shared: number;
  depth: number;
  path: string;
}

export interface AreaLayout {
  circles: Circle[];
  overlaps: Overlap[];
}

interface Item extends SimulationNodeDatum {
  x: number;
  y: number;
  radius: number;
  notes: Set<number>;
  top: Circle;
  circles: Circle[];
}

interface Link extends SimulationLinkDatum<Item> {
  distance: number;
  strength: number;
}

const RADIUS_PER_SQRT_NOTE = 4;
const GAP = 6;
const CONTAINER_PADDING = 14;
const MIN_SHARED_FOR_OVERLAP = 3;
const TICKS = 600;
const ENCLOSE_STEPS = 400;
const SETTLE_PASSES = 100;
const SEPARATION_STEP = 0.02;
const MAX_SEPARATION_STEPS = 200;
const MAX_SEPARATION_ROUNDS = 20;

function parentChain(name: string, parentOf: Map<string, string | null>): string[] {
  const chain: string[] = [];
  for (let n: string | null = name; n !== null && !chain.includes(n); n = parentOf.get(n) ?? null) {
    chain.push(n);
  }
  return chain;
}

export function buildAreaGraph(
  inputs: AreaInput[],
  noteAreas: string[][],
): AreaGraph {
  const notesOf = new Map(inputs.map((a) => [a.name, new Set<number>()]));
  const shared = new Map<string, Map<string, number>>();
  const bump = (a: string, b: string) => {
    const row = shared.get(a) ?? new Map<string, number>();
    row.set(b, (row.get(b) ?? 0) + 1);
    shared.set(a, row);
  };

  noteAreas.forEach((names, note) => {
    const known = [...new Set(names)].filter((n) => notesOf.has(n));
    for (const name of known) notesOf.get(name)?.add(note);
    for (const a of known) for (const b of known) if (a !== b) bump(a, b);
  });

  const parentOf = new Map(
    inputs.map(({ name, parent }) => [
      name,
      parent !== null && notesOf.has(parent) ? parent : null,
    ]),
  );

  const areas = inputs.map(({ name }) => {
    const chain = parentChain(name, parentOf);
    const cyclic = parentOf.get(chain[chain.length - 1]) != null;
    return {
      name,
      parent: cyclic ? null : (parentOf.get(name) ?? null),
      root: cyclic ? name : chain[chain.length - 1],
      count: notesOf.get(name)?.size ?? 0,
    };
  });

  return { areas, shared, notesOf };
}

export function intersectionArea(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a1 = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const a2 = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const k = Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return a1 + a2 - k / 2;
}

export function distanceForOverlap(r1: number, r2: number, area: number): number {
  let lo = Math.abs(r1 - r2);
  let hi = r1 + r2;
  if (area <= 0) return hi;
  if (area >= Math.PI * Math.min(r1, r2) ** 2) return lo;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (intersectionArea(r1, r2, mid) > area) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function lensPath(a: Circle, b: Circle): string | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d >= a.radius + b.radius) return null;
  if (d <= Math.abs(a.radius - b.radius)) {
    const s = a.radius < b.radius ? a : b;
    return `M ${s.x - s.radius} ${s.y} a ${s.radius} ${s.radius} 0 1 0 ${2 * s.radius} 0 a ${s.radius} ${s.radius} 0 1 0 ${-2 * s.radius} 0 Z`;
  }
  const along = (d * d + a.radius * a.radius - b.radius * b.radius) / (2 * d);
  const h = Math.sqrt(Math.max(0, a.radius * a.radius - along * along));
  const bx = a.x + (along * dx) / d;
  const by = a.y + (along * dy) / d;
  const px = bx - (h * dy) / d;
  const py = by + (h * dx) / d;
  const qx = bx + (h * dy) / d;
  const qy = by - (h * dx) / d;
  const largeA = along < 0 ? 1 : 0;
  const largeB = d - along < 0 ? 1 : 0;
  return `M ${px} ${py} A ${a.radius} ${a.radius} 0 ${largeA} 0 ${qx} ${qy} A ${b.radius} ${b.radius} 0 ${largeB} 0 ${px} ${py} Z`;
}

function intersectionSize(a: Set<number>, b: Set<number>): number {
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let n = 0;
  for (const x of small) if (large.has(x)) n++;
  return n;
}

// ponytail: O(n²) pair scan per tick, fine for the handful of siblings per area; use a quadtree if this ever lays out notes
function keepApart(minDistance: (a: Item, b: Item) => number): Force<Item, Link> {
  let nodes: Item[] = [];
  const force = (alpha: number) => {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x || 1e-6;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = minDistance(a, b);
        if (d >= min) continue;
        const push = ((min - d) / d / 2) * (1 - alpha);
        a.x -= dx * push;
        a.y -= dy * push;
        b.x += dx * push;
        b.y += dy * push;
      }
    }
  };
  force.initialize = (n: Item[]) => {
    nodes = n;
  };
  return force;
}

function contentsClash(a: Item, b: Item): boolean {
  const inner = (item: Item) => item.circles.filter((c) => c !== item.top);
  for (const p of inner(a)) {
    for (const q of inner(b)) {
      const d = Math.hypot(a.x + p.x - b.x - q.x, a.y + p.y - b.y - q.y);
      if (d < p.radius + q.radius + GAP) return true;
    }
  }
  return false;
}

function separateContents(a: Item, b: Item): boolean {
  let moved = false;
  for (let step = 0; step < MAX_SEPARATION_STEPS && contentsClash(a, b); step++) {
    const dx = b.x - a.x || 1e-6;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    const push = (SEPARATION_STEP * Math.min(a.radius, b.radius)) / d / 2;
    a.x -= dx * push;
    a.y -= dy * push;
    b.x += dx * push;
    b.y += dy * push;
    moved = true;
  }
  return moved;
}

function placeSiblings(items: Item[], depth: number, overlaps: Overlap[]): void {
  if (items.length < 2) return;
  items.forEach((item, i) => {
    const angle = (2 * Math.PI * i) / items.length;
    item.x = Math.cos(angle) * item.radius * 2;
    item.y = Math.sin(angle) * item.radius * 2;
  });

  const links: Link[] = [];
  const target = new Map<Item, Map<Item, number>>();
  const pairs: [Item, Item, number][] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const shared = intersectionSize(a.notes, b.notes);
      if (shared < MIN_SHARED_FOR_OVERLAP) continue;
      const fraction = shared / Math.min(a.notes.size, b.notes.size);
      const distance = distanceForOverlap(
        a.radius,
        b.radius,
        fraction * Math.PI * Math.min(a.radius, b.radius) ** 2,
      );
      target.set(a, (target.get(a) ?? new Map()).set(b, distance));
      target.set(b, (target.get(b) ?? new Map()).set(a, distance));
      links.push({ source: a, target: b, distance, strength: Math.min(1, shared / 8) });
      pairs.push([a, b, shared]);
    }
  }

  const apart = keepApart((a, b) => target.get(a)?.get(b) ?? a.radius + b.radius + GAP);
  forceSimulation<Item>(items)
    .force(
      "link",
      forceLink<Item, Link>(links)
        .distance((l) => l.distance)
        .strength((l) => l.strength),
    )
    .force("apart", apart)
    .force("x", forceX<Item>(0).strength(0.15))
    .force("y", forceY<Item>(0).strength(0.15))
    .alphaDecay(0.01)
    .stop()
    .tick(TICKS);
  for (let i = 0; i < SETTLE_PASSES; i++) apart(0);
  const containerPairs = pairs.filter(([a, b]) => a.top.container || b.top.container);
  for (let round = 0; round < MAX_SEPARATION_ROUNDS; round++) {
    let moved = false;
    for (const [a, b] of containerPairs) moved = separateContents(a, b) || moved;
    if (!moved) break;
    for (let i = 0; i < SETTLE_PASSES; i++) apart(0);
  }

  for (const [a, b, shared] of pairs) {
    overlaps.push({ a: a.top, b: b.top, shared, depth, path: "" });
  }
}

export function enclose(items: { x: number; y: number; radius: number }[]): {
  cx: number;
  cy: number;
  radius: number;
} {
  let cx = items[0].x;
  let cy = items[0].y;
  const reach = (i: { x: number; y: number; radius: number }) => Math.hypot(i.x - cx, i.y - cy) + i.radius;
  for (let step = 1; step <= ENCLOSE_STEPS; step++) {
    const far = items.reduce((a, b) => (reach(b) > reach(a) ? b : a));
    const d = Math.hypot(far.x - cx, far.y - cy) || 1;
    const px = far.x + ((far.x - cx) / d) * far.radius;
    const py = far.y + ((far.y - cy) / d) * far.radius;
    cx += (px - cx) / (step + 1);
    cy += (py - cy) / (step + 1);
  }
  return { cx, cy, radius: Math.max(...items.map(reach)) };
}

function translate(circles: Circle[], dx: number, dy: number): void {
  for (const c of circles) {
    c.x += dx;
    c.y += dy;
  }
}

export function layoutAreaGraph(graph: AreaGraph): AreaLayout {
  const childrenOf = new Map<string | null, GraphArea[]>();
  for (const a of graph.areas) {
    childrenOf.set(a.parent, [...(childrenOf.get(a.parent) ?? []), a]);
  }
  const overlaps: Overlap[] = [];

  const leaf = (area: GraphArea, depth: number, notes: Set<number>): Item => {
    const radius = RADIUS_PER_SQRT_NOTE * Math.sqrt(notes.size);
    const top: Circle = {
      name: area.name,
      root: area.root,
      container: false,
      depth,
      count: notes.size,
      x: 0,
      y: 0,
      radius,
    };
    return { x: 0, y: 0, radius, notes, top, circles: [top] };
  };

  const layoutArea = (area: GraphArea, depth: number): Item | null => {
    const direct = graph.notesOf.get(area.name) ?? new Set<number>();
    const kids = (childrenOf.get(area.name) ?? [])
      .map((child) => layoutArea(child, depth + 1))
      .filter((item): item is Item => item !== null);
    if (kids.length === 0) return direct.size > 0 ? leaf(area, depth, direct) : null;

    const items = [...(direct.size > 0 ? [leaf(area, depth + 1, direct)] : []), ...kids];
    placeSiblings(items, depth + 1, overlaps);
    for (const item of items) translate(item.circles, item.x, item.y);

    const { cx, cy, radius: enclosing } = enclose(items);
    const radius = enclosing + CONTAINER_PADDING;
    const inner = items.flatMap((i) => i.circles);
    translate(inner, -cx, -cy);

    const notes = new Set<number>(direct);
    for (const kid of kids) for (const n of kid.notes) notes.add(n);
    const top: Circle = {
      name: area.name,
      root: area.root,
      container: true,
      depth,
      count: notes.size,
      x: 0,
      y: 0,
      radius,
    };
    return { x: 0, y: 0, radius, notes, top, circles: [top, ...inner] };
  };

  const roots = (childrenOf.get(null) ?? [])
    .map((root) => layoutArea(root, 0))
    .filter((item): item is Item => item !== null);
  placeSiblings(roots, 0, overlaps);
  for (const item of roots) translate(item.circles, item.x, item.y);

  const drawn: Overlap[] = [];
  for (const o of overlaps) {
    const path = lensPath(o.a, o.b);
    if (path) drawn.push({ ...o, path });
  }

  return { circles: roots.flatMap((r) => r.circles), overlaps: drawn };
}

const LABEL_MIN_PX = 11;
const LABEL_MAX_PX = 22;
const LABEL_FILL = 1.8;

export function labelPx(radiusPx: number): number {
  return Math.min(LABEL_MAX_PX, Math.max(LABEL_MIN_PX, radiusPx * 0.3));
}

export function labelFits(widthPerPx: number, radiusPx: number, fill = LABEL_FILL): boolean {
  return widthPerPx * labelPx(radiusPx) <= fill * radiusPx;
}
