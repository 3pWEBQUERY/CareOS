/**
 * CSV lesen und schreiben (PRD §41 strukturierte Importe) – rein, ohne Server-Abhängigkeiten, testbar.
 *
 * Typische Quellen sind Exporte aus Excel und Branchensoftware in der Schweiz: Semikolon als Trennzeichen,
 * UTF-8 mit BOM oder Windows-1252, Zeilenumbrüche CRLF, Felder in Anführungszeichen mit verdoppelten "".
 */

export type CsvRow = { /** Zeilennummer in der Datei (1 = Kopfzeile), für Fehlermeldungen. */ line: number; cells: string[] }
export type CsvTable = { delimiter: string; header: string[]; rows: CsvRow[] }

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024
export const MAX_IMPORT_ROWS = 5000

/** Bytes → Text: UTF-8 (mit/ohne BOM), sonst Windows-1252 (Excel «CSV (Trennzeichen-getrennt)»). */
export function decodeCsv(bytes: Uint8Array): string {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes)
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Trennzeichen aus der ersten Zeile (ausserhalb von Anführungszeichen): ; , oder Tab. Standard ; */
export function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 }
  let quoted = false
  for (const ch of text) {
    if (ch === '"') quoted = !quoted
    else if (!quoted && (ch === '\n' || ch === '\r')) break
    else if (!quoted && ch in counts) counts[ch]++
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return best[1] > 0 ? best[0] : ';'
}

/**
 * Zerlegt CSV-Text in Zeilen und Zellen (RFC 4180 mit Toleranz): Anführungszeichen, "" als Escape,
 * Zeilenumbrüche innerhalb von Anführungszeichen, CRLF/LF/CR. Leere Zeilen werden übersprungen,
 * Zeilennummern zählen trotzdem weiter (Meldungen beziehen sich auf die Datei, wie sie in Excel aussieht).
 */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): CsvTable {
  const records: CsvRow[] = []
  let cells: string[] = []
  let cell = ''
  let quoted = false
  let line = 1
  let start = 1
  let i = 0
  const push = () => {
    cells.push(cell)
    cell = ''
  }
  const endRecord = () => {
    push()
    if (cells.some((c) => c.trim() !== '')) records.push({ line: start, cells: cells.map((c) => c.trim()) })
    cells = []
  }
  while (i < text.length) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue }
        quoted = false
        i++
        continue
      }
      if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) line++
      cell += ch
      i++
      continue
    }
    if (ch === '"' && cell.trim() === '') { cell = ''; quoted = true; i++; continue }
    if (ch === delimiter) { push(); i++; continue }
    if (ch === '\r' || ch === '\n') {
      endRecord()
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1
      line++
      start = line
      continue
    }
    cell += ch
    i++
  }
  if (cell !== '' || cells.length) endRecord()
  const [head, ...rows] = records
  return { delimiter, header: head ? head.cells : [], rows }
}

/** Formel-Injektion in Tabellenprogrammen verhindern (=, +, -, @ am Anfang). Zahlen wie -5 bleiben. */
export function safeCell(v: string) {
  return /^[=+\-@\t\r]/.test(v) && !/^-?\d+([.,]\d+)?$/.test(v) ? "'" + v : v
}

/** Tabelle → CSV (Semikolon, CRLF, UTF-8 mit BOM, damit Excel Umlaute richtig zeigt). */
export function toCsv(rows: string[][], delimiter = ';') {
  const esc = (v: string) => {
    const s = safeCell(v ?? '')
    return /["\r\n]/.test(s) || s.includes(delimiter) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  return '﻿' + rows.map((r) => r.map(esc).join(delimiter)).join('\r\n') + '\r\n'
}

/** Spaltennamen vergleichbar machen: klein, ohne Akzente, nur Buchstaben/Ziffern («E-Mail» = «email»). */
export const headerKey = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').toLowerCase().replace(/[^a-z0-9]/g, '')
