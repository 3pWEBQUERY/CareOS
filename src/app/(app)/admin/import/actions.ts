'use server'

import { z } from 'zod'
import { getCtx, assertCan, type Ctx } from '@/lib/context'
import { run, fd, fdBool, type ActionResult } from '@/lib/action'
import { audit } from '@/lib/audit'
import { MAX_IMPORT_BYTES, decodeCsv, parseCsv } from '@/lib/import/csv'
import { IMPORT_KINDS, type ImportKind } from '@/lib/import/specs'
import { allowedKinds, commit, digestOf, prepare, type ImportReport, type RowStatus } from '@/lib/import/run'

const Kind = z.enum(IMPORT_KINDS)

/** Datei lesen und prüfen; gemeinsam für Probelauf und Import. */
async function load(ctx: Ctx, form: FormData) {
  assertCan(ctx, 'admin.users')
  const kind = Kind.parse(fd(form, 'kind'))
  if (!allowedKinds(ctx).includes(kind)) return { error: 'imports.errors.kind' as const }
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'imports.errors.file' as const }
  if (file.size > MAX_IMPORT_BYTES) return { error: 'imports.errors.tooLarge' as const }
  const text = decodeCsv(new Uint8Array(await file.arrayBuffer()))
  const digest = digestOf(text)
  const { report, plan } = await prepare(ctx, kind, parseCsv(text), digest)
  return { kind, fileName: file.name.slice(0, 200), digest, report, plan }
}

/** Probelauf (Dry-Run): prüft jede Zeile gegen Format und Stammdaten, schreibt nichts. */
export async function previewImportAction(form: FormData): Promise<ActionResult<ImportReport & { fileName: string }>> {
  return run(async () => {
    const ctx = await getCtx()
    const r = await load(ctx, form)
    if ('error' in r) return { ok: false, error: r.error!, field: 'file' }
    await audit(ctx, { action: 'import.dry_run', entityType: 'Import', entityId: r.digest, after: r.report.counts, context: { kind: r.kind, fileName: r.fileName, rows: r.report.total } })
    return { ok: true, data: { ...r.report, fileName: r.fileName } }
  })
}

/**
 * Import ausführen: dieselbe Datei wie im Probelauf (Prüfsumme), erneute Prüfung, dann alle gültigen
 * Zeilen in einer Transaktion. Fehlerhafte Zeilen nur mit ausdrücklicher Zustimmung überspringen.
 */
export async function commitImportAction(form: FormData): Promise<ActionResult<{ written: number; counts: Record<RowStatus, number> }>> {
  return run(async () => {
    const ctx = await getCtx()
    const r = await load(ctx, form)
    if ('error' in r) return { ok: false, error: r.error!, field: 'file' }
    if (r.digest !== fd(form, 'digest')) return { ok: false, error: 'imports.errors.changed' }
    if (r.report.fileIssues.length) return { ok: false, error: 'imports.errors.hasErrors' }
    if (r.report.counts.error && !fdBool(form, 'skipErrors')) return { ok: false, error: 'imports.errors.hasErrors' }
    if (!r.report.counts.create && !r.report.counts.update) return { ok: false, error: 'imports.errors.nothing' }
    const { written } = await commit(ctx, r.kind as ImportKind, r.plan, { fileName: r.fileName, digest: r.digest })
    return { ok: true, data: { written, counts: r.report.counts } }
  })
}
