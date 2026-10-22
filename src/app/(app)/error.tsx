'use client'

import { ErrorState } from '@/components/ui/ErrorState'

/** Fehler in einer Ansicht: Shell (Navigation, Suche) bleibt nutzbar. */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorState error={error} retry={retry} />
}
