/**
 * Bearbeitungsstand eines auffälligen Vitalwerts (PRD §14, Paket B): «Gesehen 14:05 · AM» bzw. «Massnahme 14:05 · AM».
 * Text statt nur Farbe; die eingeleitete Massnahme steht im Titel und für Screenreader im Text.
 */
export function ReviewTag({ kind, label, time, by, note }: { kind: string | null; label: string; time: string; by: string; note?: string | null }) {
  return (
    <span className={'tag ' + (kind === 'action' ? 'accent' : 'ok')} title={note ?? undefined}>
      {label} {time} · {by}
      {note ? <span className="sr-only">: {note}</span> : null}
    </span>
  )
}
