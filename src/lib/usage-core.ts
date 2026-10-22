/** Produktkennzahlen – reine Logik (testbar), genutzt von src/lib/usage.ts. */
export const MIN_GROUP = 3

/** Modul je Audit-Aktion (erster Teil des Schlüssels; KI-Nutzung über «.ai»). */
export const MODULES: { key: string; match: (action: string) => boolean }[] = [
  { key: 'chart', match: (a) => a.startsWith('observation.') },
  { key: 'vitals', match: (a) => a.startsWith('vitals.') },
  { key: 'meds', match: (a) => a.startsWith('medication.') },
  { key: 'tasks', match: (a) => a.startsWith('task.') },
  { key: 'handover', match: (a) => a.startsWith('handover.') },
  { key: 'careplan', match: (a) => a.startsWith('careplan.') },
  { key: 'assessments', match: (a) => a.startsWith('assessment.') },
  { key: 'wounds', match: (a) => a.startsWith('wound.') },
  { key: 'nutrition', match: (a) => a.startsWith('nutrition.') },
  { key: 'quality', match: (a) => a.startsWith('incident.') },
  { key: 'visit', match: (a) => a.startsWith('visit.') },
  { key: 'schedule', match: (a) => /^(shift|swap|absence|schedule)\./.test(a) },
  { key: 'team', match: (a) => a.startsWith('post.') },
  { key: 'chat', match: (a) => /^(message|conversation)\./.test(a) },
  { key: 'docs', match: (a) => a.startsWith('document.') },
  { key: 'learn', match: (a) => a.startsWith('learn.') },
  { key: 'ai', match: (a) => a.startsWith('ai.') || a.includes('.ai') },
]

export function adoption(rows: { action: string; userId: string; n: number }[]) {
  return MODULES.map((m) => {
    const hit = rows.filter((r) => m.match(r.action))
    const users = new Set(hit.map((r) => r.userId)).size
    return { key: m.key, users, events: hit.reduce((s, r) => s + r.n, 0) }
  })
}

export function median(xs: number[]) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

