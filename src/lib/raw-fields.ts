/**
 * Findet rohe <input>/<select>/<textarea> in TSX-Quelltext (ausser <input type="hidden"> und Zeilen mit
 * `raw-field-ok: <Grund>` davor oder darin). Genutzt von raw-fields.test.ts.
 */
/** Ende des JSX-Starttags ab `start` (berücksichtigt {…}-Ausdrücke und Zeichenketten). */
export function tagEnd(src: string, start: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return i
  }
  return src.length
}

/** Kommentare (/* … *\/ und ganze //-Zeilen) durch Leerzeichen ersetzen – Zeilen und Positionen bleiben erhalten. */
function blankComments(src: string) {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ')
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^[ \t]*\/\/.*$/gm, blank)
}

export function findRawFields(original: string): { line: number; tag: string }[] {
  const out: { line: number; tag: string }[] = []
  const src = blankComments(original)
  const lines = original.split('\n')
  const re = /<(input|select|textarea)(?=[\s/>])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const end = tagEnd(src, m.index + 1)
    const tag = src.slice(m.index, end + 1)
    if (m[1] === 'input' && /\btype=(?:"hidden"|'hidden'|\{\s*['"]hidden['"]\s*\})/.test(tag)) continue
    const line = src.slice(0, m.index).split('\n').length
    if (/raw-field-ok:/.test(lines[line - 1] ?? '') || /raw-field-ok:/.test(lines[line - 2] ?? '')) continue
    out.push({ line, tag: tag.replace(/\s+/g, ' ').slice(0, 90) })
  }
  return out
}
