'use client'

import { ErrorState } from '@/components/ui/ErrorState'

/** Fehler in einem Register der Akte: Banner und Register bleiben sichtbar (eindeutige Zuordnung, PRD §32). */
export default function RecordError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorState error={error} retry={retry} compact />
}
