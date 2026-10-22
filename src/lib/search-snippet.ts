/** Kurzer Textausschnitt rund um den ersten Treffer (globale Suche). Reine Funktion. */
export function snippet(text: string, q: string, max = 80) {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const i = flat.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return flat.slice(0, max - 1).trimEnd() + '…'
  const before = Math.max(0, Math.min(i - Math.floor((max - q.length) / 2), flat.length - max))
  const out = flat.slice(before, before + max).trim()
  return (before > 0 ? '…' : '') + out + (before + max < flat.length ? '…' : '')
}
