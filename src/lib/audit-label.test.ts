import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { LABELLED_ACTIONS, auditLabel } from '../app/(app)/admin/audit-label'
import { LOCALES, makeT } from '../i18n/core'
import admin from '../i18n/messages/admin'

const SRC = join(process.cwd(), 'src')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !n.endsWith('.test.ts') ? [p] : []
  })
}

/** Statisch lesbare Aktionsschlüssel: `action: '…'`, beide Zweige einer Bedingung, `platformAudit(…, '…')`. */
function actionKeys() {
  const keys = new Set<string>()
  for (const f of files(SRC)) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/action: ([^,}\n]+)/g)) for (const s of m[1].matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/g)) keys.add(s[1])
    for (const m of src.matchAll(/platformAudit\([^,]+, [^,]+, '([a-z_]+(?:\.[a-z_]+)+)'[,)]/g)) keys.add(m[1])
  }
  return keys
}

/** Bereiche, deren Aktionen im Audit-Protokoll lesbar erscheinen müssen (Portal, Arztportal, Therapie, ADT, Schnittstellen, Notfallzugriff …). */
const MUST_LABEL = ['portal.', 'md.', 'therapy.', 'adt.', 'api.hl7.', 'api.fhir.allergy.', 'billing.', 'emergency.', 'platform.', 'admin.physician.', 'medication.stock.', 'medication.order.confirm']

test('Audit: neue Aktionsbereiche haben eine lesbare Bezeichnung', () => {
  const labelled = new Set<string>(LABELLED_ACTIONS)
  const missing = [...actionKeys()].filter((k) => MUST_LABEL.some((p) => k.startsWith(p)) && !labelled.has(k))
  assert.deepEqual(missing, [], 'In src/app/(app)/admin/audit-label.ts und admin.ux.act ergänzen')
})

test('Audit: jede Bezeichnung ist in allen Sprachen hinterlegt', () => {
  for (const locale of LOCALES) {
    const t = makeT({ admin: admin[locale] }, locale, 'resident')
    for (const a of LABELLED_ACTIONS) {
      const key = 'admin.ux.act.' + a.replace(/\./g, '_')
      assert.notEqual(auditLabel(t, a), key, `${locale}: ${key} fehlt`)
    }
  }
})
