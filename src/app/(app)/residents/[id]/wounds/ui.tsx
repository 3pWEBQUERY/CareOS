/** Wundstatus als Tag: Text plus Ton, nie nur Farbe. */
export function StatusTag({ status, label }: { status: string; label: string }) {
  return <span className={'tag ' + (status === 'open' ? 'warn' : status === 'healing' ? 'accent' : '')}>{label}</span>
}
