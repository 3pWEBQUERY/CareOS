/**
 * Absicherung Design System (PRD §50): ausserhalb von src/components/ui/ keine rohen <input>, <select>, <textarea>.
 * Formulare verwenden die Komponenten aus `@/components/ui/fields` (TextField, NumberField, Select, Combobox,
 * Textarea, Checkbox, Switch, RadioGroup, FileField, DateField …). Erlaubt bleiben <input type="hidden"> und
 * begründete Ausnahmen mit dem Kommentar `raw-field-ok: <Grund>` in der Zeile davor oder in der Zeile selbst.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { findRawFields } from './raw-fields'

const ROOT = join(process.cwd(), 'src')
const ALLOWED_DIR = join(ROOT, 'components', 'ui')

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (p.endsWith('.tsx')) yield p
  }
}

test('Erkennung roher Felder', () => {
  assert.equal(findRawFields('<input type="hidden" name="x" value={a > b ? 1 : 2} />').length, 0)
  assert.equal(findRawFields('<input\n  name="x"\n  type="hidden"\n/>').length, 0)
  assert.equal(findRawFields('<input className="field" name="x" />').length, 1)
  assert.equal(findRawFields('<select value={a}>…</select><textarea />').length, 2)
  assert.equal(findRawFields('{/* raw-field-ok: Befehlspalette */}\n<input role="combobox" />').length, 0)
  assert.equal(findRawFields('<inputs /> <Select /> <TextField />').length, 0)
  assert.equal(findRawFields('/**\n * anders als `<input capture>`\n */\n// <select> im Kommentar\nconst x = 1').length, 0)
})

test('Keine rohen <input>/<select>/<textarea> ausserhalb von src/components/ui/', () => {
  const hits: string[] = []
  for (const file of walk(ROOT)) {
    if (file.startsWith(ALLOWED_DIR)) continue
    for (const h of findRawFields(readFileSync(file, 'utf8'))) hits.push(`${relative(process.cwd(), file)}:${h.line}  ${h.tag}`)
  }
  assert.deepEqual(hits, [], 'Feld-Komponenten aus @/components/ui/fields verwenden:\n' + hits.join('\n'))
})
