import { gunzipSync } from "node:zlib";
import { ApiError } from "@/lib/api-context";
import type { EmediplanDraft, EmediplanLine, EmediplanSlot } from "@/lib/emediplan-shared";

export { dosesBySlot } from "@/lib/emediplan-shared";

// Lesen des ChTransmissionFormat (Inhalt des QR-Codes auf dem eMediplan) laut Spezifikation der IG eMediplan:
// `CHMED16A0{JSON}`, `CHMED16A1{Base64(gzip(JSON))}` und `CHMED23A.{Base64(gzip(JSON))}`, bei CHMED23A auch auf mehrere
// QR-Codes verteilt (`CHMED23A.1/3.…`, je Code eine Zeile). Gelesen wird nur, was im Plan steht – ohne
// Arzneimitteldatenbank, ohne Prüfung. Dosierungen, die sich nicht eindeutig als tägliche Gabe abbilden lassen,
// bleiben zur Erfassung von Hand.

const MAX_LENGTH = 200_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown) =>
  typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
const day = (value: unknown) => {
  const text = str(value).slice(0, 10);
  return DATE.test(text) ? text : null;
};

const damaged = () => new ApiError("Der eMediplan-Code ist unvollständig oder beschädigt. Bitte erneut scannen.");

function unzip(data: string) {
  try {
    return gunzipSync(Buffer.from(data.trim(), "base64")).toString("utf8");
  } catch {
    throw damaged();
  }
}

// CHMED23A: ein Code oder mehrere Teile (je Zeile einer); die Teile werden nach ihrer Nummer zusammengesetzt.
function chmed23(lines: string[]) {
  const parts = lines.map((line) => /^CHMED23([A-Z]+)(?:\.([1-9]\d*)\/([1-9]\d*))?\.([\s\S]*)$/i.exec(line));
  if (parts.some((part) => !part)) throw damaged();
  const subVersion = parts[0]![1].toUpperCase();
  if (parts.length === 1 && !parts[0]![2]) return { version: `CHMED23${subVersion}`, json: unzip(parts[0]![4]) };
  const total = Number(parts[0]![3]);
  const chunks = new Map<number, string>();
  for (const part of parts) {
    if (!part![2] || Number(part![3]) !== total) throw damaged();
    chunks.set(Number(part![2]), part![4].trim());
  }
  const missing = Array.from({ length: total }, (_, index) => index + 1).filter((index) => !chunks.has(index));
  if (missing.length)
    throw new ApiError(
      `Es fehlen Teile des eMediplans (${missing.join(", ")} von ${total}). Bitte alle QR-Codes scannen.`,
    );
  return {
    version: `CHMED23${subVersion}`,
    json: unzip(Array.from({ length: total }, (_, index) => chunks.get(index + 1)).join("")),
  };
}

// Inhalt des QR-Codes in das JSON-Objekt des Plans umwandeln.
export function decodeChmed(input: string): { version: string; plan: Json } {
  const code = input.trim();
  if (!code) throw new ApiError("Bitte den Inhalt des eMediplan-QR-Codes einfügen oder scannen.");
  if (code.length > MAX_LENGTH) throw new ApiError("Der Code ist zu lang für einen eMediplan.");
  const match = /^CHMED(\d{2})([A-Z]+)/i.exec(code);
  if (!match) throw new ApiError("Das ist kein eMediplan-Code (er beginnt nicht mit „CHMED“).");
  const year = match[1];
  let version: string;
  let json: string;
  if (year === "23") {
    const lines = code
      .split(/\s*\n\s*/)
      .map((line) => line.trim())
      .filter(Boolean);
    ({ version, json } = chmed23(lines));
  } else {
    const v16 = /^CHMED16([A-Z])([01])([\s\S]*)$/i.exec(code);
    if (year !== "16" || !v16) throw new ApiError(`Diese eMediplan-Version (CHMED${year}) wird nicht unterstützt.`);
    version = `CHMED16${v16[1].toUpperCase()}`;
    json = v16[2] === "1" ? unzip(v16[3]) : v16[3];
  }
  let plan: unknown;
  try {
    plan = JSON.parse(json);
  } catch {
    throw damaged();
  }
  const meds = isObject(plan) ? (year === "23" ? plan.meds : plan.Medicaments) : null;
  if (!isObject(plan) || !Array.isArray(meds) || !meds.length)
    throw new ApiError("Der eMediplan enthält keine Medikamente.");
  return { version, plan };
}

function doses(value: unknown): Record<EmediplanSlot, number> | null {
  if (!Array.isArray(value) || !value.length) return null;
  const numbers = value.slice(0, 4).map((item) => (typeof item === "number" && Number.isFinite(item) ? item : 0));
  while (numbers.length < 4) numbers.push(0);
  if (numbers.every((item) => item === 0)) return null;
  return { morning: numbers[0], noon: numbers[1], evening: numbers[2], night: numbers[3] };
}

// Plan in Entwurfszeilen übersetzen (ohne Zuordnung zum eigenen Präparatestamm).
export function draftFromPlan(version: string, plan: Json): Omit<EmediplanDraft, "patientMismatch"> {
  return version.startsWith("CHMED23") ? draft23(version, plan) : draft16(version, plan);
}

function draft16(version: string, plan: Json): Omit<EmediplanDraft, "patientMismatch"> {
  const patient = isObject(plan.Patient) ? plan.Patient : {};
  const lines: EmediplanLine[] = (plan.Medicaments as unknown[]).filter(isObject).map((item, index) => {
    const positions = Array.isArray(item.Pos) ? item.Pos.filter(isObject) : [];
    const first = positions[0] ?? {};
    const idType = typeof item.IdType === "number" ? item.IdType : 1;
    const id = str(item.Id);
    const timed = Array.isArray(first.TT) && first.TT.length > 0;
    return {
      index,
      idType,
      id,
      freeText: idType === 1 ? id : null,
      unit: str(item.Unit),
      route: str(item.Roa),
      reason: str(item.TkgRsn),
      instructions: str(item.AppInstr),
      prescribedBy: str(item.PrscbBy),
      selfMedication: item.AutoMed === 1,
      from: day(first.DtFrom),
      to: day(first.DtTo),
      reserve: first.InRes === 1,
      doses: timed ? null : doses(first.D),
      timedDoses: null,
      complex: timed || positions.length > 1,
      match: null,
    };
  });
  return {
    version,
    issuedAt: str(plan.Dt) || null,
    author: str(plan.Auth),
    remark: str(plan.Rmk),
    patient: {
      firstName: str(patient.FName),
      lastName: str(patient.LName),
      birthDate: day(patient.BDt),
    },
    lines,
  };
}

const SEGMENTS: Record<number, EmediplanSlot> = { 1: "morning", 2: "noon", 3: "evening", 4: "night" };
// Einfache Dosis (DosageSimple, Typ 1); andere Dosisarten (von–bis, Bereich) bleiben von Hand.
const simpleAmount = (value: unknown) =>
  isObject(value) && value.t === 1 && typeof value.a === "number" && value.a > 0 ? value.a : null;

// CHMED23A-Dosierung, soweit sie eindeutig täglich ist: Daily (Morgen/Mittag/Abend/Nacht) oder Cyclic jeden Tag einmal
// mit Tagesabschnitten oder festen Uhrzeiten. Alles andere: null (von Hand).
function posology23(po: unknown): Pick<EmediplanLine, "doses" | "timedDoses"> | null {
  if (!isObject(po)) return null;
  if (po.t === 1) {
    const daily = doses(po.ds);
    return daily ? { doses: daily, timedDoses: null } : null;
  }
  const everyDay = po.t === 4 && po.cyDuU === 4 && po.cyDu === 1 && (po.tdpc === undefined || po.tdpc === 1);
  const tdo = isObject(po.tdo) ? po.tdo : null;
  if (!everyDay || !tdo) return null;
  if (tdo.t === 3 && Array.isArray(tdo.ss)) {
    const result: Record<EmediplanSlot, number> = { morning: 0, noon: 0, evening: 0, night: 0 };
    for (const entry of tdo.ss) {
      const slot = isObject(entry) && typeof entry.s === "number" ? SEGMENTS[entry.s] : undefined;
      const amount = isObject(entry) ? simpleAmount(entry.do) : null;
      if (!slot || amount === null || result[slot]) return null;
      result[slot] = amount;
    }
    return Object.values(result).some((value) => value > 0) ? { doses: result, timedDoses: null } : null;
  }
  if (tdo.t === 2 && Array.isArray(tdo.ts) && tdo.ts.length) {
    const timed: Array<{ time: string; dose: number }> = [];
    for (const entry of tdo.ts) {
      const time = isObject(entry) ? /^(\d{2}):(\d{2})/.exec(str(entry.dt)) : null;
      const amount = isObject(entry) ? simpleAmount(entry.do) : null;
      if (!time || amount === null || Number(time[1]) > 23 || Number(time[2]) > 59) return null;
      timed.push({ time: `${time[1]}:${time[2]}`, dose: amount });
    }
    return { doses: null, timedDoses: timed.sort((a, b) => a.time.localeCompare(b.time)) };
  }
  return null;
}

function draft23(version: string, plan: Json): Omit<EmediplanDraft, "patientMismatch"> {
  const patient = isObject(plan.patient) ? plan.patient : {};
  const person = isObject(plan.hcPerson) ? plan.hcPerson : null;
  const lines: EmediplanLine[] = (plan.meds as unknown[]).filter(isObject).map((item, index) => {
    const positions = Array.isArray(item.pos) ? item.pos.filter(isObject) : [];
    const first = positions[0] ?? {};
    const idType = typeof item.idType === "number" ? item.idType : 1;
    const id = str(item.id);
    const po = isObject(first.po) ? first.po : null;
    const reserve = first.inRes === true;
    const simple = reserve ? null : posology23(po);
    const freeText = po?.t === 2 ? str(po.text) : "";
    return {
      index,
      idType,
      id,
      freeText: idType === 1 ? id : null,
      unit: str(first.unit),
      route: str(first.roa),
      reason: str(item.rsn),
      instructions: [str(first.appInstr), freeText].filter(Boolean).join(" · "),
      prescribedBy: str(item.prscbBy),
      selfMedication: item.autoMed === true,
      from: day(first.dtFrom),
      to: day(first.dtTo),
      reserve,
      doses: simple?.doses ?? null,
      timedDoses: simple?.timedDoses ?? null,
      // Reserve braucht keine Zeiten; sonst nur eindeutig tägliche Dosierungen übernehmen.
      complex: positions.length > 1 || (!reserve && !simple && po !== null),
      match: null,
    };
  });
  return {
    version,
    issuedAt: str(plan.dt) || null,
    author: person ? [str(person.fName), str(person.lName)].filter(Boolean).join(" ") || str(person.gln) : "",
    remark: str(plan.rmk),
    patient: {
      firstName: str(patient.fName),
      lastName: str(patient.lName),
      birthDate: day(patient.bdt),
    },
    lines,
  };
}
