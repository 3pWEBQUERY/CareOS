/** Zeitabhängiger Zustand einer offenen Aufgabe (Server und Client): überfällig ab 15 Min. nach Fälligkeit, «jetzt fällig» 30 Min. davor. */
export function dueView(dueAt: Date, now = new Date()): 'over' | 'due' | 'up' {
  const diff = (dueAt.getTime() - now.getTime()) / 60_000
  if (diff < -15) return 'over'
  if (diff <= 30) return 'due'
  return 'up'
}
