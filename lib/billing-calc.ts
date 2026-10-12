// Berechnung eines Monats je Person (reine Funktion, ohne Datenbank). Jeder Tag wird einzeln bewertet: im Haus
// laut Aufenthalt, Pflegestufe an diesem Tag, Preis an diesem Tag, Abwesenheit mit der Regel der Taxe.
import {
  PAYERS,
  RATE_CATEGORIES,
  type Absence,
  type BillingLine,
  type BillingMonth,
  type BillingRate,
  type Payer,
  type StayPeriod,
} from "@/lib/billing-shared";

const DAY = 86_400_000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const toDate = (time: number) => new Date(time).toISOString().slice(0, 10);

export function monthDays(month: string) {
  const start = toTime(`${month}-01`);
  const [year, monthIndex] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => toDate(start + index * DAY));
}

// Tag im Haus: ab dem Eintrittstag; der Austrittstag zählt nur, wenn die Einrichtung ihn verrechnet.
export function billedOn(day: string, stays: StayPeriod[], dischargeDayBilled: boolean) {
  return stays.some(
    (stay) =>
      stay.from <= day && (stay.until === null || day < stay.until || (dischargeDayBilled && day === stay.until)),
  );
}

// Laufende Abwesenheit an einem Tag mit der Nummer des Abwesenheitstags (1 = erster ganzer Tag).
export function absenceOn(day: string, absences: Pick<Absence, "kind" | "startsOn" | "endsOn">[]) {
  const found = absences.find(
    (absence) => absence.startsOn <= day && (absence.endsOn === null || day <= absence.endsOn),
  );
  if (!found) return null;
  return { kind: found.kind, number: Math.round((toTime(day) - toTime(found.startsOn)) / DAY) + 1 };
}

export function careLevelOn(day: string, levels: Array<{ level: string; validFrom: string }>) {
  let current: string | null = null;
  let since = "";
  for (const entry of levels)
    if (entry.validFrom <= day && entry.validFrom >= since) {
      current = entry.level;
      since = entry.validFrom;
    }
  return current;
}

export function priceOn(day: string, rate: Pick<BillingRate, "prices">) {
  let price: number | null = null;
  let since = "";
  for (const entry of rate.prices)
    if (entry.validFrom <= day && entry.validFrom >= since) {
      price = entry.amountCents;
      since = entry.validFrom;
    }
  return price;
}

const CATEGORY_ORDER = Object.keys(RATE_CATEGORIES);
const PAYER_ORDER = Object.keys(PAYERS) as Payer[];

export function computeMonth(input: {
  month: string;
  stays: StayPeriod[];
  dischargeDayBilled: boolean;
  rates: BillingRate[];
  careLevels: Array<{ level: string; validFrom: string }>;
  absences: Array<Pick<Absence, "kind" | "startsOn" | "endsOn">>;
  assigned: Array<{ rateId: string; validFrom: string; validUntil: string | null }>;
}): BillingMonth {
  const rates = input.rates.filter((rate) => !rate.archived);
  const lines = new Map<string, BillingLine>();
  const absentDays = { hospital: 0, absence: 0 };
  let billedDays = 0;
  const missingLevel: string[] = [];
  const missingTariff = new Set<string>();

  for (const day of monthDays(input.month)) {
    if (!billedOn(day, input.stays, input.dischargeDayBilled)) continue;
    billedDays += 1;
    const absence = absenceOn(day, input.absences);
    const absenceKind = absence ? (absence.kind === "hospital" ? "hospital" : "absence") : null;
    if (absenceKind) absentDays[absenceKind] += 1;
    const level = careLevelOn(day, input.careLevels);
    if (!level) missingLevel.push(day);
    else if (!rates.some((rate) => rate.category === "care" && rate.careLevel === level && priceOn(day, rate) !== null))
      missingTariff.add(level);

    for (const rate of rates) {
      if (rate.category === "care" ? rate.careLevel !== level : false) continue;
      if (
        rate.applies === "assigned" &&
        !input.assigned.some(
          (entry) =>
            entry.rateId === rate.id &&
            entry.validFrom <= day &&
            (entry.validUntil === null || day <= entry.validUntil),
        )
      )
        continue;
      const price = priceOn(day, rate);
      if (price === null) continue;
      const key = `${rate.id}:${price}`;
      const line = lines.get(key) ?? {
        rateId: rate.id,
        name: rate.name,
        category: rate.category,
        payer: rate.payer,
        priceCents: price,
        fullDays: 0,
        reduced: [],
        amountCents: 0,
      };
      lines.set(key, line);
      const rule = absenceKind === "hospital" ? rate.hospital : absenceKind ? rate.absence : null;
      if (absence && absenceKind && rule && absence.number > rule.fullDays) {
        const slot = line.reduced.find((entry) => entry.percent === rule.percent && entry.kind === absenceKind);
        if (slot) slot.days += 1;
        else line.reduced.push({ days: 1, percent: rule.percent, kind: absenceKind });
      } else line.fullDays += 1;
    }
  }

  const ordered = [...lines.values()]
    .map((line) => ({
      ...line,
      amountCents:
        line.priceCents * line.fullDays +
        line.reduced.reduce((sum, entry) => sum + Math.round((line.priceCents * entry.days * entry.percent) / 100), 0),
    }))
    .sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
        rates.findIndex((rate) => rate.id === a.rateId) - rates.findIndex((rate) => rate.id === b.rateId) ||
        a.priceCents - b.priceCents,
    );
  const totals = PAYER_ORDER.map((payer) => ({
    payer,
    amountCents: ordered.filter((line) => line.payer === payer).reduce((sum, line) => sum + line.amountCents, 0),
  })).filter((total) => ordered.some((line) => line.payer === total.payer));
  const warnings: string[] = [];
  if (missingLevel.length)
    warnings.push(
      `An ${missingLevel.length} ${missingLevel.length === 1 ? "Tag" : "Tagen"} ist keine Pflegestufe erfasst; Pflege wird dafür nicht verrechnet.`,
    );
  for (const level of missingTariff) warnings.push(`Für „${level}“ ist kein Pflegetarif erfasst.`);
  return {
    month: input.month,
    billedDays,
    absentDays,
    lines: ordered,
    totals,
    totalCents: ordered.reduce((sum, line) => sum + line.amountCents, 0),
    warnings,
  };
}
