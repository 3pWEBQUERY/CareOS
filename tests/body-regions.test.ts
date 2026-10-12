import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyRegion, nearestYaw } from "@/lib/body-regions";
import { BODY_REGION_POINTS } from "@/lib/body-region-points";

const front = { x: 0, y: 0, z: 1 };
const back = { x: 0, y: 0, z: -1 };
const outward = (x: number) => ({ x: Math.sign(x), y: 0, z: 0 });

test("Körperstelle: Rumpf vorne und hinten, Seite aus Sicht der Person", () => {
  assert.equal(bodyRegion({ x: 0, y: 2.6, z: 0.2 }, front, "male"), "Brustbein");
  assert.equal(bodyRegion({ x: 0.25, y: 2.6, z: 0.2 }, front, "male"), "Brust links");
  assert.equal(bodyRegion({ x: -0.25, y: 2.6, z: -0.2 }, back, "male"), "Schulterblatt rechts");
  assert.equal(bodyRegion({ x: 0, y: 1.9, z: -0.2 }, back, "female"), "Kreuzbein");
  assert.equal(bodyRegion({ x: 0.12, y: 1.75, z: -0.3 }, back, "female"), "Gesäss links");
  assert.equal(bodyRegion({ x: 0, y: 3.4, z: -0.2 }, back, "male"), "Hinterkopf");
});

test("Körperstelle: Arme und Beine mit innen/aussen", () => {
  assert.equal(bodyRegion({ x: 0.5, y: 1.9, z: 0 }, front, "male"), "Unterarm links, vorne");
  assert.equal(bodyRegion({ x: 0.52, y: 1.9, z: 0 }, outward(0.52), "male"), "Unterarm links, aussen");
  assert.equal(bodyRegion({ x: -0.8, y: 2.0, z: 0 }, back, "female"), "Unterarm rechts, hinten");
  assert.equal(bodyRegion({ x: 0.17, y: 1.0, z: 0.1 }, back, "male"), "Kniekehle links");
  assert.equal(bodyRegion({ x: -0.16, y: 0.5, z: 0.1 }, front, "male"), "Unterschenkel rechts, Schienbein");
  assert.equal(bodyRegion({ x: -0.2, y: 0.07, z: -0.1 }, back, "female"), "Ferse rechts");
  assert.equal(bodyRegion({ x: 0.19, y: 0.14, z: 0 }, outward(0.19), "male"), "Aussenknöchel links");
});

test("Referenzpunkte je Region sind eindeutig und liegen im Modell", () => {
  for (const sex of ["female", "male"] as const) {
    const points = BODY_REGION_POINTS[sex];
    assert.ok(points.length > 60);
    assert.equal(new Set(points.map(([region]) => region)).size, points.length);
    for (const [, , x, y, z] of points) {
      assert.ok(Math.abs(x) <= 1.1 && y >= 0 && y <= 3.55 && Math.abs(z) <= 0.6);
    }
  }
});

test("Drehung auf dem kürzesten Weg", () => {
  assert.equal(nearestYaw(0, Math.PI / 2), Math.PI / 2);
  assert.ok(Math.abs(nearestYaw(4 * Math.PI, 0) - 4 * Math.PI) < 1e-9);
  assert.ok(Math.abs(nearestYaw(2 * Math.PI + 0.1, Math.PI) - 3 * Math.PI) < 1e-9);
});
