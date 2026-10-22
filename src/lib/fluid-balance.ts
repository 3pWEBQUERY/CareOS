/**
 * Flüssigkeitsbilanz (PRD §14): Einfuhr (Trinken, Infusion s.c./i.v., Sonde) und Ausfuhr (Urin, Drainage,
 * Erbrechen, sonstige) je Tag. Gespeichert als IntakeLog.kind; Server und Client.
 * Eine Bilanz wird nur ausgewiesen, wenn am Tag Ausfuhr erfasst wurde – sonst wäre «+1500 ml» irreführend.
 */
export const FLUID_IN = ['in_infusion', 'in_tube'] as const
export const FLUID_OUT = ['out_urine', 'out_drain', 'out_vomit', 'out_other'] as const
export const FLUID_KINDS = [...FLUID_IN, ...FLUID_OUT] as const
export type FluidKind = (typeof FLUID_KINDS)[number]
/** Plausible Menge je Eintrag in ml */
export const FLUID_LIMITS = { min: 5, max: 3000 } as const

export const isFluidIn = (kind: string) => kind === 'drink' || (FLUID_IN as readonly string[]).includes(kind)
export const isFluidOut = (kind: string) => (FLUID_OUT as readonly string[]).includes(kind)

export type FluidLog = { kind: string; amountMl: number | null; at: Date }
export type FluidDay = {
  day: Date
  /** Einfuhr gesamt und je Art */
  inMl: number
  in: Record<'drink' | (typeof FLUID_IN)[number], number>
  outMl: number
  out: Record<(typeof FLUID_OUT)[number], number>
  /** Anzahl Ausfuhr-Einträge; 0 = Ausfuhr nicht erfasst */
  outEntries: number
  /** Einfuhr − Ausfuhr; null, wenn keine Ausfuhr erfasst ist */
  balance: number | null
}

const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** Bilanz je Kalendertag (Stationszeit) für die angegebenen Tage. */
export function fluidBalance(logs: FluidLog[], days: Date[]): FluidDay[] {
  return days.map((d) => {
    const from = startOf(d)
    const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1)
    const of = logs.filter((l) => l.at >= from && l.at < to && l.amountMl != null)
    const inBy = { drink: 0, in_infusion: 0, in_tube: 0 }
    const outBy = { out_urine: 0, out_drain: 0, out_vomit: 0, out_other: 0 }
    let outEntries = 0
    for (const l of of) {
      if (isFluidIn(l.kind)) inBy[l.kind as keyof typeof inBy] += l.amountMl!
      else if (isFluidOut(l.kind)) { outBy[l.kind as keyof typeof outBy] += l.amountMl!; outEntries++ }
    }
    const inMl = Object.values(inBy).reduce((a, b) => a + b, 0)
    const outMl = Object.values(outBy).reduce((a, b) => a + b, 0)
    return { day: from, inMl, in: inBy, outMl, out: outBy, outEntries, balance: outEntries ? inMl - outMl : null }
  })
}

/** Vorzeichen immer sichtbar (Bilanz), Minus als echtes Minuszeichen. */
export const signedMl = (v: number, fmt: (n: number) => string) => (v > 0 ? '+' : v < 0 ? '−' : '±') + fmt(Math.abs(v))
