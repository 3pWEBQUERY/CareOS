// Anatomische Bezeichnung einer Körperstelle aus einem Punkt auf dem 3D-Körpermodell (Bewohnerakte).
// Modellkoordinaten: Füsse bei y = 0, Scheitel bei y = 3.55, Blick in +z. Die linke Körperseite der
// Person liegt bei +x (sie steht der betrachtenden Person gegenüber).
// Die Grenzen folgen den üblichen Körperproportionen und der Geometrie der beiden Modelle
// (public/body-surfaces); das Ergebnis ist ein Vorschlag, den die Pflege im Befund anpassen kann.

export type BodySex = "female" | "male";
export type Vec3 = { x: number; y: number; z: number };

export const BODY_HEIGHT = 3.55;

// Ab dieser seitlichen Entfernung zur Körpermitte gehört ein Punkt zum Arm (je Höhe; die Arme des
// weiblichen Modells stehen weiter ab).
function armThreshold(y: number, sex: BodySex) {
  if (sex === "male") return y < 2.3 ? 0.4 : 0.42;
  if (y < 1.9) return 0.5;
  if (y < 2.1) return 0.46;
  if (y < 2.3) return 0.4;
  return 0.39;
}

type Facing = "front" | "back" | "side" | "top" | "bottom";

function facingOf(normal: Vec3): Facing {
  if (normal.y > 0.75) return "top";
  if (normal.y < -0.75) return "bottom";
  if (normal.z > 0.42) return "front";
  if (normal.z < -0.42) return "back";
  return "side";
}

const sideOf = (x: number) => (x > 0 ? "links" : "rechts");

// Innen/aussen für Arme und Beine: zeigt die Oberfläche von der Körpermitte weg, ist es die Aussenseite.
const limbSide = (point: Vec3, normal: Vec3) => (Math.sign(normal.x) === Math.sign(point.x) ? "aussen" : "innen");

function limb(name: string, point: Vec3, normal: Vec3, front: string, back: string) {
  const facing = facingOf(normal);
  const detail = facing === "front" ? front : facing === "back" ? back : limbSide(point, normal);
  return `${name} ${sideOf(point.x)}, ${detail}`;
}

function arm(point: Vec3, normal: Vec3) {
  const { y } = point;
  if (y >= 2.62) return `Schulter ${sideOf(point.x)}`;
  if (y >= 2.3) return limb("Oberarm", point, normal, "vorne", "hinten");
  if (y >= 2.1) return `Ellenbogen ${sideOf(point.x)}`;
  if (y >= 1.74) return limb("Unterarm", point, normal, "vorne", "hinten");
  return `Hand ${sideOf(point.x)}`;
}

function head(point: Vec3, normal: Vec3) {
  const facing = facingOf(normal);
  if (facing === "top") return "Scheitel";
  if (facing === "back") return "Hinterkopf";
  if (facing === "side") return `Schläfe/Ohr ${sideOf(point.x)}`;
  if (facing === "bottom") return "Kinn";
  return point.y > 3.3 ? "Stirn" : "Gesicht";
}

function trunk(point: Vec3, normal: Vec3) {
  const { x, y } = point;
  const facing = facingOf(normal);
  const midline = Math.abs(x) < 0.07;
  const side = sideOf(x);
  if (y >= 2.88) return facing === "back" ? "Nacken" : "Hals";
  if (y >= 2.35) {
    if (facing === "back") return midline ? "Wirbelsäule (Brustwirbel)" : `Schulterblatt ${side}`;
    if (facing === "side") return `Brustkorb seitlich ${side}`;
    return midline ? "Brustbein" : `Brust ${side}`;
  }
  if (y >= 2.0) {
    if (facing === "back") return midline ? "Wirbelsäule (Lendenwirbel)" : `Rücken ${side}`;
    if (facing === "side") return `Flanke ${side}`;
    return midline ? "Oberbauch" : `Oberbauch ${side}`;
  }
  if (y >= 1.72) {
    if (facing === "back") return midline && y >= 1.8 ? "Kreuzbein" : `Gesäss ${side}`;
    if (facing === "side") return `Hüfte ${side}`;
    return Math.abs(x) > 0.16 && y < 1.86 ? `Leiste ${side}` : midline ? "Unterbauch" : `Unterbauch ${side}`;
  }
  // Übergang Rumpf/Beine zwischen Schritt und Gesässfalte.
  if (facing === "back") return `Gesäss ${side}`;
  if (midline) return "Intimbereich";
  return limb("Oberschenkel", point, normal, "vorne", "hinten");
}

function leg(point: Vec3, normal: Vec3) {
  const { y } = point;
  const facing = facingOf(normal);
  const side = sideOf(point.x);
  if (y >= 1.1) return limb("Oberschenkel", point, normal, "vorne", "hinten");
  if (y >= 0.88) return facing === "back" ? `Kniekehle ${side}` : `Knie ${side}`;
  if (y >= 0.2) return limb("Unterschenkel", point, normal, "Schienbein", "Wade");
  if (y >= 0.09) {
    if (facing === "back") return `Ferse ${side}`;
    if (facing === "side") return `${limbSide(point, normal) === "aussen" ? "Aussenknöchel" : "Innenknöchel"} ${side}`;
    return `Fussrücken ${side}`;
  }
  if (facing === "bottom") return `Fusssohle ${side}`;
  if (facing === "back") return `Ferse ${side}`;
  if (facing === "side") return `Fuss ${side}, ${limbSide(point, normal)}`;
  return `Zehen/Vorfuss ${side}`;
}

export function bodyRegion(point: Vec3, normal: Vec3, sex: BodySex): string {
  const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
  const n = { x: normal.x / length, y: normal.y / length, z: normal.z / length };
  if (point.y >= 3.05) return head(point, n);
  if (point.y >= 1.35 && Math.abs(point.x) > armThreshold(point.y, sex)) return arm(point, n);
  if (point.y >= 1.6) return trunk(point, n);
  return leg(point, n);
}

// Ansichten des Modells: Drehung um die Hochachse, damit die jeweilige Seite zur Kamera zeigt.
export const BODY_VIEWS = [
  { id: "front", label: "Vorne", yaw: 0 },
  { id: "right", label: "Rechts", yaw: Math.PI / 2 },
  { id: "back", label: "Hinten", yaw: Math.PI },
  { id: "left", label: "Links", yaw: -Math.PI / 2 },
] as const;

// Kürzester Weg von der aktuellen Drehung zur gewünschten (in Bogenmass, beliebig viele Umdrehungen).
export function nearestYaw(current: number, target: number) {
  const turns = Math.round((current - target) / (Math.PI * 2));
  return target + turns * Math.PI * 2;
}
