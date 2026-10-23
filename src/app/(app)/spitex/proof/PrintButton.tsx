'use client'

/** Druckansicht des Leistungsnachweises (Shell und Bedienelemente blendet @media print aus). */
export function PrintButton({ label }: { label: string }) {
  return <button type="button" className="btn primary no-print" onClick={() => window.print()}>{label}</button>
}
