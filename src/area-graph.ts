import { hierarchy, pack } from "d3-hierarchy";

export interface AreaInput {
  name: string;
  parent: string | null;
}

export interface GraphArea {
  name: string;
  parent: string | null;
  count: number;
}

export interface AreaGraph {
  areas: GraphArea[];
  shared: Map<string, Map<string, number>>;
}

export interface Circle {
  name: string;
  x: number;
  y: number;
  radius: number;
  container: boolean;
}

interface PackNode {
  name: string;
  count: number;
  container: boolean;
  children?: PackNode[];
}

const LAYOUT_SIZE = 1000;
const CONTAINER_PADDING = 18;
const SIBLING_PADDING = 4;

function hasCycle(name: string, parentOf: Map<string, string | null>): boolean {
  const seen = new Set<string>();
  for (let n: string | null = name; n !== null; n = parentOf.get(n) ?? null) {
    if (seen.has(n)) return true;
    seen.add(n);
  }
  return false;
}

export function buildAreaGraph(
  inputs: AreaInput[],
  noteAreas: string[][],
): AreaGraph {
  const counts = new Map(inputs.map((a) => [a.name, 0]));
  const shared = new Map<string, Map<string, number>>();
  const bump = (a: string, b: string) => {
    const row = shared.get(a) ?? new Map<string, number>();
    row.set(b, (row.get(b) ?? 0) + 1);
    shared.set(a, row);
  };

  for (const names of noteAreas) {
    const known = [...new Set(names)].filter((n) => counts.has(n));
    for (const name of known) counts.set(name, (counts.get(name) ?? 0) + 1);
    for (const a of known) for (const b of known) if (a !== b) bump(a, b);
  }

  const parentOf = new Map(
    inputs.map(({ name, parent }) => [
      name,
      parent !== null && counts.has(parent) ? parent : null,
    ]),
  );
  const areas = inputs.map(({ name }) => ({
    name,
    parent: hasCycle(name, parentOf) ? null : (parentOf.get(name) ?? null),
    count: counts.get(name) ?? 0,
  }));

  return { areas, shared };
}

export function layoutAreaGraph(graph: AreaGraph): Circle[] {
  const childrenOf = new Map<string | null, GraphArea[]>();
  for (const a of graph.areas) {
    childrenOf.set(a.parent, [...(childrenOf.get(a.parent) ?? []), a]);
  }

  const toNode = (area: GraphArea): PackNode => {
    const kids = childrenOf.get(area.name) ?? [];
    const self = { name: area.name, count: area.count, container: false };
    if (kids.length === 0) return self;
    return {
      name: area.name,
      count: 0,
      container: true,
      children: [...(area.count > 0 ? [self] : []), ...kids.map(toNode)],
    };
  };

  const root = hierarchy<PackNode>({
    name: "",
    count: 0,
    container: true,
    children: (childrenOf.get(null) ?? []).map(toNode),
  })
    .sum((d) => (d.children ? 0 : Math.max(1, d.count)))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  return pack<PackNode>()
    .size([LAYOUT_SIZE, LAYOUT_SIZE])
    .padding((d) => (d.depth === 0 ? SIBLING_PADDING * 4 : CONTAINER_PADDING))(root)
    .descendants()
    .filter((d) => d.depth > 0)
    .map((d) => ({
      name: d.data.name,
      x: d.x,
      y: d.y,
      radius: d.r,
      container: d.data.container,
    }));
}
