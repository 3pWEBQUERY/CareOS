/** Health Check – reine Logik (testbar), genutzt von src/lib/health.ts. */
export type JobState = 'ok' | 'stale' | 'failing' | 'pending' | 'disabled'

/** Erwarteter Abstand je Job, ab dem ein fehlender Lauf als überfällig gilt. */
export const JOB_EXPECT_MS: Record<string, number> = {
  escalations: 15 * 60_000,
  security: 15 * 60_000,
  cleanup: 2 * 3600_000,
  retention: 26 * 3600_000,
  tasks: 15 * 60_000,
}

export type JobHealth = { name: string; state: JobState; lastStartedAt: Date | null; lastOk: boolean | null; durationMs: number | null; error: string | null }

export function jobState(last: { startedAt: Date; finishedAt: Date | null; ok: boolean | null } | null, expectMs: number, now: Date, uptimeMs: number, disabledHere: boolean): JobState {
  if (!last) return uptimeMs < 5 * 60_000 ? 'pending' : disabledHere ? 'disabled' : 'stale'
  if (last.ok === false) return 'failing'
  if (now.getTime() - last.startedAt.getTime() > expectMs) return disabledHere ? 'disabled' : 'stale'
  return 'ok'
}

