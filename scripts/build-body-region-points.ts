// Erzeugt lib/body-region-points.ts: je Körperregion einen Referenzpunkt auf der Modelloberfläche.
// Dafür werden aus den vier Ansichten (vorne, hinten, rechts, links) Strahlen auf das Modell geworfen,
// jeder Treffer mit bodyRegion() benannt und je Region der Treffer nahe dem Schwerpunkt genommen.
// Aufruf: node --import ./scripts/node-ts/register.mjs --experimental-transform-types scripts/build-body-region-points.ts
import { readFileSync, writeFileSync } from "node:fs";
import { BODY_HEIGHT, bodyRegion, type BodySex } from "../lib/body-regions";

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const MODEL_HEIGHT: Record<BodySex, number> = { female: 1.65778, male: 1.71948 };
const VIEWS = {
  front: { direction: [0, 0, -1] as V, axis: 0 },
  back: { direction: [0, 0, 1] as V, axis: 0 },
  right: { direction: [1, 0, 0] as V, axis: 2 },
  left: { direction: [-1, 0, 0] as V, axis: 2 },
};
type ViewId = keyof typeof VIEWS;

function triangles(sex: BodySex) {
  const file = readFileSync(`public/body-surfaces/${sex}.bin`);
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const header = new DataView(buffer);
  const vertexCount = header.getUint32(0, true);
  const indexCount = header.getUint32(4, true);
  const positions = new Float32Array(buffer, 8, vertexCount * 3);
  const indices = new Uint32Array(buffer, 8 + vertexCount * 18, indexCount);
  const scale = BODY_HEIGHT / MODEL_HEIGHT[sex];
  const point = (i: number): V => [
    positions[i * 3] * scale,
    positions[i * 3 + 1] * scale,
    positions[i * 3 + 2] * scale,
  ];
  const result: V[][] = [];
  for (let t = 0; t < indexCount; t += 3)
    result.push([point(indices[t]), point(indices[t + 1]), point(indices[t + 2])]);
  return result;
}

const output: string[] = [];
for (const sex of ["female", "male"] as const) {
  const tris = triangles(sex);
  const best = new Map<string, { count: number; view: ViewId; point: V }>();
  for (const [view, { direction, axis }] of Object.entries(VIEWS) as Array<[ViewId, (typeof VIEWS)[ViewId]]>) {
    const cell = 0.04;
    const grid = new Map<string, number[]>();
    tris.forEach((tri, index) => {
      const us = tri.map((p) => p[axis]);
      const ys = tri.map((p) => p[1]);
      for (let a = Math.floor(Math.min(...us) / cell); a <= Math.floor(Math.max(...us) / cell); a++)
        for (let b = Math.floor(Math.min(...ys) / cell); b <= Math.floor(Math.max(...ys) / cell); b++) {
          const key = `${a},${b}`;
          const list = grid.get(key) ?? [];
          list.push(index);
          grid.set(key, list);
        }
    });
    const hits = new Map<string, V[]>();
    for (let y = 0.01; y < BODY_HEIGHT; y += 0.02)
      for (let u = -1.1; u < 1.1; u += 0.02) {
        const origin: V = [0, y, 0];
        origin[axis] = u;
        for (let k = 0; k < 3; k++) if (direction[k]) origin[k] = -direction[k] * 5;
        let nearest = Infinity;
        let hit: { point: V; normal: V } | null = null;
        for (const index of grid.get(`${Math.floor(u / cell)},${Math.floor(y / cell)}`) ?? []) {
          const [a, b, c] = tris[index];
          const e1 = sub(b, a);
          const e2 = sub(c, a);
          const h = cross(direction, e2);
          const det = dot(e1, h);
          if (Math.abs(det) < 1e-12) continue;
          const f = 1 / det;
          const s = sub(origin, a);
          const bu = f * dot(s, h);
          if (bu < 0 || bu > 1) continue;
          const q = cross(s, e1);
          const bv = f * dot(direction, q);
          if (bv < 0 || bu + bv > 1) continue;
          const t = f * dot(e2, q);
          if (t <= 0 || t >= nearest) continue;
          nearest = t;
          let normal = cross(e1, e2);
          if (dot(normal, direction) > 0) normal = [-normal[0], -normal[1], -normal[2]];
          hit = {
            point: [origin[0] + direction[0] * t, origin[1] + direction[1] * t, origin[2] + direction[2] * t],
            normal,
          };
        }
        if (!hit) continue;
        const region = bodyRegion(
          { x: hit.point[0], y: hit.point[1], z: hit.point[2] },
          { x: hit.normal[0], y: hit.normal[1], z: hit.normal[2] },
          sex,
        );
        const list = hits.get(region) ?? [];
        list.push(hit.point);
        hits.set(region, list);
      }
    for (const [region, points] of hits) {
      const current = best.get(region);
      if (current && current.count >= points.length) continue;
      const center = [0, 1, 2].map((k) => points.reduce((sum, p) => sum + p[k], 0) / points.length);
      const point = points.reduce((closest, p) =>
        dot(sub(p, center as V), sub(p, center as V)) < dot(sub(closest, center as V), sub(closest, center as V))
          ? p
          : closest,
      );
      best.set(region, { count: points.length, view, point });
    }
  }
  output.push(`  ${sex}: [`);
  for (const [region, { view, point }] of [...best].sort(
    (a, b) => b[1].point[1] - a[1].point[1] || a[0].localeCompare(b[0], "de"),
  ))
    output.push(`    [${JSON.stringify(region)}, "${view}", ${point.map((v) => +v.toFixed(3)).join(", ")}],`);
  output.push("  ],");
}

writeFileSync(
  "lib/body-region-points.ts",
  `// Erzeugt von scripts/build-body-region-points.ts – nicht von Hand ändern.
// Je Körperregion ein Punkt auf der Modelloberfläche und die Ansicht, aus der die Region am besten sichtbar ist.
import type { BodySex } from "./body-regions";

export type BodyRegionPoint = [region: string, view: "front" | "back" | "right" | "left", x: number, y: number, z: number];

export const BODY_REGION_POINTS: Record<BodySex, BodyRegionPoint[]> = {
${output.join("\n")}
};
`,
);
