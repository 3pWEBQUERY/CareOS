/**
 * Fokusdokumentation automatisch anbieten (PRD §10.3): Regeln erkennen relevante Veränderungen und schlagen ein
 * Formular oder einen Verlaufseintrag vor – bis die Dokumentation vorliegt oder das Zeitfenster abgelaufen ist.
 * Reine Logik (Server und Client). Konfiguration in Organization.settings.focusDocumentation (optional).
 *
 *  - pain:          Schmerz NRS ≥ Schwelle in einer Messung → Formular «Schmerzerfassung»
 *  - fall:          Verlaufseintrag erwähnt einen Sturz → Formular «Sturzprotokoll»
 *  - vitalAbnormal: Messung ausserhalb der Grenzwerte (ohne Schmerz) → Verlaufseintrag «Beobachtung»
 *  - taskSkipped:   dieselbe Massnahme wiederholt «nicht durchgeführt» → Verlaufseintrag (Ursache, Planung prüfen)
 */

export const FOCUS_RULE_KEYS = ['pain', 'fall', 'vitalAbnormal', 'taskSkipped'] as const
export type FocusRuleKey = (typeof FOCUS_RULE_KEYS)[number]

export type FocusRule = {
  key: FocusRuleKey
  enabled: boolean
  /** Formular (FormDefinition.key); null = freier Verlaufseintrag */
  formKey: string | null
  /** Schwelle: NRS (pain) bzw. Anzahl Auslassungen (taskSkipped) */
  threshold?: number
  /** Zeitfenster in Stunden, in dem der Vorschlag offen bleibt */
  windowH: number
}

export const DEFAULT_FOCUS_RULES: FocusRule[] = [
  { key: 'pain', enabled: true, formKey: 'schmerzerfassung', threshold: 4, windowH: 12 },
  { key: 'fall', enabled: true, formKey: 'sturzprotokoll', windowH: 24 },
  { key: 'vitalAbnormal', enabled: true, formKey: null, windowH: 8 },
  { key: 'taskSkipped', enabled: true, formKey: null, threshold: 2, windowH: 48 },
]

/** Regeln aus den Organisationseinstellungen, ergänzt um Standardwerte; ungültige Angaben werden ignoriert. */
export function focusRules(settings: unknown): FocusRule[] {
  const raw = (settings && typeof settings === 'object' ? (settings as Record<string, unknown>).focusDocumentation : null) as Record<string, unknown> | null
  return DEFAULT_FOCUS_RULES.map((d) => {
    const o = raw && typeof raw[d.key] === 'object' && raw[d.key] ? (raw[d.key] as Record<string, unknown>) : {}
    const num = (v: unknown, lo: number, hi: number, fb?: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : fb)
    const threshold = num(o.threshold, 1, 10, d.threshold)
    return {
      key: d.key,
      enabled: typeof o.enabled === 'boolean' ? o.enabled : d.enabled,
      formKey: o.formKey === null ? null : typeof o.formKey === 'string' && o.formKey.trim() ? o.formKey.trim() : d.formKey,
      ...(threshold != null ? { threshold } : {}),
      windowH: num(o.windowH, 1, 168, d.windowH)!,
    }
  })
}

/** Sturz im Freitext (DE/FR/IT/EN) – bewusst ohne «Fall»/«gefallen» (mehrdeutig). */
export const FALL_RE = /(^|[^\p{L}])(sturz|stürz|gestürzt|gestuerzt|sturzereignis|am boden (aufgefunden|liegend)|chute|chuté|tombée? (au sol|par terre)|caduta|caduto|caduta a terra|fell|fall event|found on the floor)/iu

export type FocusVital = { id: string; at: Date; pain: number | null; abnormal: string[] }
export type FocusNote = { id: string; at: Date; text: string; formKey: string | null; source: string; taskId: string | null }
export type FocusTask = { id: string; title: string; status: string; completedAt: Date | null }

export type FocusSuggestion = {
  /** stabil je Auslöser (zum Ausblenden auf dem Gerät) */
  id: string
  rule: FocusRuleKey
  at: Date
  formKey: string | null
  /** Vorbelegung des Formulars (Feldschlüssel → Wert) bzw. Text des Verlaufseintrags */
  prefill: Record<string, string>
  vars: Record<string, string | number>
}

/**
 * Offene Vorschläge: Auslöser im Zeitfenster, für die noch keine passende Dokumentation danach vorliegt.
 * `forms`: aktive Formularschlüssel – ein Vorschlag mit nicht vorhandenem Formular fällt auf einen Verlaufseintrag zurück.
 */
export function pendingFocus(input: { rules: FocusRule[]; vitals: FocusVital[]; notes: FocusNote[]; tasks: FocusTask[]; forms: string[]; now?: Date }): FocusSuggestion[] {
  const now = input.now ?? new Date()
  const out: FocusSuggestion[] = []
  const since = (h: number) => new Date(now.getTime() - h * 3600_000)
  const form = (k: string | null) => (k && input.forms.includes(k) ? k : null)
  const formAfter = (k: string, at: Date) => input.notes.some((n) => n.formKey === k && n.at >= at)
  const freeAfter = (at: Date) => input.notes.some((n) => !n.formKey && n.source !== 'task' && n.at >= at)

  for (const rule of input.rules) {
    if (!rule.enabled) continue
    const from = since(rule.windowH)
    if (rule.key === 'pain') {
      const v = input.vitals.filter((x) => x.at >= from && x.pain != null && x.pain >= (rule.threshold ?? 4)).sort((a, b) => +b.at - +a.at)[0]
      if (!v) continue
      const fk = form(rule.formKey)
      if (fk ? formAfter(fk, v.at) : freeAfter(v.at)) continue
      out.push({ id: 'pain:' + v.id, rule: 'pain', at: v.at, formKey: fk, prefill: fk ? { nrs: String(v.pain) } : {}, vars: { nrs: v.pain! } })
    }
    if (rule.key === 'vitalAbnormal') {
      const v = input.vitals.filter((x) => x.at >= from && x.abnormal.some((k) => k !== 'pain')).sort((a, b) => +b.at - +a.at)[0]
      if (!v) continue
      const fk = form(rule.formKey)
      if (fk ? formAfter(fk, v.at) : freeAfter(v.at)) continue
      out.push({ id: 'vital:' + v.id, rule: 'vitalAbnormal', at: v.at, formKey: fk, prefill: {}, vars: { n: v.abnormal.filter((k) => k !== 'pain').length } })
    }
    if (rule.key === 'fall') {
      const n = input.notes.filter((x) => x.at >= from && !x.formKey && FALL_RE.test(x.text)).sort((a, b) => +b.at - +a.at)[0]
      if (!n) continue
      const fk = form(rule.formKey)
      if (!fk || formAfter(fk, n.at)) continue
      out.push({ id: 'fall:' + n.id, rule: 'fall', at: n.at, formKey: fk, prefill: {}, vars: {} })
    }
    if (rule.key === 'taskSkipped') {
      const skipped = input.tasks.filter((x) => x.status === 'skipped' && x.completedAt && x.completedAt >= from)
      const byTitle = new Map<string, FocusTask[]>()
      for (const x of skipped) byTitle.set(x.title, [...(byTitle.get(x.title) ?? []), x])
      for (const [title, list] of byTitle) {
        if (list.length < (rule.threshold ?? 2)) continue
        const last = list.reduce((a, b) => (b.completedAt! > a.completedAt! ? b : a))
        const fk = form(rule.formKey)
        if (fk ? formAfter(fk, last.completedAt!) : freeAfter(last.completedAt!)) continue
        out.push({ id: 'skip:' + last.id, rule: 'taskSkipped', at: last.completedAt!, formKey: fk, prefill: {}, vars: { title, n: list.length } })
      }
    }
  }
  return out.sort((a, b) => +b.at - +a.at)
}
