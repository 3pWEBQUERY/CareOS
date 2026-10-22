'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useLocale, useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { Checkbox, FileField, SegmentedControl } from '@/components/ui/fields'
import { toCsv } from '@/lib/import/csv'
import { SPECS, TEMPLATE_EXAMPLE, templateHeader, type ImportKind, type Issue } from '@/lib/import/specs'
import type { ImportReport, RowResult, RowStatus } from '@/lib/import/run'
import { commitImportAction, previewImportAction } from './actions'

type Report = ImportReport & { fileName: string }
type Filter = 'all' | 'error' | 'warn'

const SHOW_MAX = 300
const STATUS_TONE: Record<RowStatus, string> = { create: 'ok', update: 'accent', skip: '', error: 'crit' }
const TARGET: Record<ImportKind, string> = { residents: '/residents', staff: '/admin/users', shifts: '/schedule?view=team' }

const download = (name: string, csv: string) => {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ImportClient({ kinds }: { kinds: ImportKind[] }) {
  const t = useT()
  const locale = useLocale()
  const [kind, setKind] = useState<ImportKind>(kinds[0])
  const [file, setFile] = useState<File | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [skipErrors, setSkipErrors] = useState(false)
  const [done, setDone] = useState<{ written: number } | null>(null)
  const [fieldKey, setFieldKey] = useState(0)
  const [checking, startCheck] = useTransition()
  const [importing, startImport] = useTransition()
  const [ask, confirmDialog] = useConfirm()
  const tr = (k: string) => (/^[a-z]+\.[\w.]+$/.test(k) ? t(k) : k)
  const resRef = useRef<HTMLHeadingElement>(null)
  // Nach der Prüfung zum Ergebnis springen und es vorlesen lassen (Fokus auf die Überschrift)
  useEffect(() => {
    if (!report || !resRef.current) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    resRef.current.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
    resRef.current.focus({ preventScroll: true })
  }, [report])

  const colName = (key: string) => SPECS[kind].find((s) => s.key === key)?.names[locale][0] ?? key
  const msg = (i: Issue) => t('imports.err.' + i.code, { ...i.vars, col: i.col ? colName(i.col) : '' })

  const reset = (k: ImportKind = kind) => {
    setKind(k)
    setFile(null)
    setReport(null)
    setError(null)
    setDone(null)
    setSkipErrors(false)
    setFilter('all')
    setFieldKey((x) => x + 1)
  }

  const form = (extra: Record<string, string> = {}) => {
    const fd = new FormData()
    fd.set('kind', kind)
    if (file) fd.set('file', file)
    for (const [k, v] of Object.entries(extra)) fd.set(k, v)
    return fd
  }

  const check = () => {
    if (!file) { setError(t('imports.errors.file')); return }
    setError(null)
    setDone(null)
    startCheck(async () => {
      const r = await previewImportAction(form())
      if (r.ok && r.data) { setReport(r.data); setFilter(r.data.counts.error ? 'error' : 'all'); setSkipErrors(false) }
      else if (!r.ok) { setReport(null); setError(tr(r.error)) }
    })
  }

  const importNow = async () => {
    if (!report) return
    const c = report.counts
    const ok = await ask({
      title: t('imports.confirm'),
      text: t('imports.confirmText', { create: c.create, update: c.update, skip: c.skip, error: c.error }),
      context: <span><strong>{t('imports.kind.' + kind)}</strong> · {report.fileName}</span>,
      confirmLabel: t('imports.submit', { n: c.create + c.update }),
    })
    if (!ok) return
    startImport(async () => {
      const r = await commitImportAction(form({ digest: report.digest, skipErrors: skipErrors ? 'on' : '' }))
      if (r.ok && r.data) {
        setDone({ written: r.data.written })
        toast(t('imports.done', { n: r.data.written }))
      } else if (!r.ok) toast(tr(r.error), { kind: 'crit' })
    })
  }

  const exportReport = () => {
    if (!report) return
    const rows = report.rows.filter((r) => r.issues.length || r.warnings.length || r.status === 'skip')
    const csv = toCsv([
      [t('imports.table.line'), t('imports.table.status'), t('imports.table.record'), t('imports.table.messages')],
      ...report.fileIssues.map((i) => ['', t('imports.status.error'), report.fileName, msg(i)]),
      ...rows.map((r) => [String(r.line), t('imports.status.' + r.status), r.label, [...r.issues, ...r.warnings].map(msg).join(' | ')]),
    ])
    download(`${report.fileName.replace(/\.csv$/i, '')}-${t('imports.table.messages').toLowerCase()}.csv`, csv)
  }

  const template = () => {
    const header = templateHeader(kind, locale)
    const example = SPECS[kind].map((s) => TEMPLATE_EXAMPLE[kind][s.key] ?? '')
    download(`${t('imports.kind.' + kind).toLowerCase().replace(/[^\p{L}\d]+/gu, '-')}.csv`, toCsv([header, example]))
  }

  const rows = useMemo(() => {
    if (!report) return [] as RowResult[]
    if (filter === 'error') return report.rows.filter((r) => r.status === 'error')
    if (filter === 'warn') return report.rows.filter((r) => r.warnings.length > 0)
    return report.rows
  }, [report, filter])

  const writable = report ? report.counts.create + report.counts.update : 0
  const blocked = !report || !!report.fileIssues.length || !writable || (report.counts.error > 0 && !skipErrors)

  return (
    <div className="stack">
      {kinds.length > 1 && (
        <SegmentedControl label={t('imports.kind.label')} hideLabel name="kind" value={kind} onChange={(v) => reset(v as ImportKind)} options={kinds.map((k) => ({ value: k, label: t('imports.kind.' + k) }))} />
      )}

      <div className="imp-grid">
        <section className="card" aria-labelledby="imp-file">
          <div className="card-head"><h2 id="imp-file">{t('imports.step1')}</h2></div>
          <div className="card-body stack">
            <p className="small fg2" style={{ margin: 0 }}>{t('imports.rules.' + kind)}</p>
            <FileField key={fieldKey} label={t('imports.file')} hint={t('imports.checkHint')} name="file" accept=".csv,text/csv,text/plain" maxSize={2 * 1024 * 1024} typesLabel="CSV" onFiles={(f) => { setFile(f[0] ?? null); setReport(null); setDone(null); setError(null) }} error={error} />
            <div className="form-actions">
              <button type="button" className="btn ghost" onClick={template}>{t('imports.template')}</button>
              <span className="spacer" />
              <button type="button" className="btn primary" onClick={check} disabled={checking || importing || !file} data-loading={checking || undefined}>{t('imports.check')}</button>
            </div>
          </div>
        </section>

        <details className="card imp-colcard" open={!report}>
          <summary className="card-head"><h2 id="imp-cols">{t('imports.columns')} <span className="pill">{SPECS[kind].length}</span></h2></summary>
          <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}>
            <table className="stable imp-cols">
              <thead><tr><th>{t('imports.col.name')}</th><th>{t('imports.col.format')}</th></tr></thead>
              <tbody>
                {SPECS[kind].map((s) => (
                  <tr key={s.key}>
                    <td className="nowrap">{s.names[locale][0]}{s.required && <> <span className="tag outline">{t('imports.yes')}</span></>}</td>
                    <td className="small">
                      {t('imports.fmt.' + s.type)}
                      {(['unit', 'room', 'careLevel', 'email', 'role', 'roleScope', 'qualifications', 'shift', 'person'] as const).includes(s.key as never) && <span className="muted" style={{ display: 'block' }}>{t('imports.note.' + s.key)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-foot small muted">{t('imports.templateHint')}</div>
        </details>
      </div>

      {report && (
        <section className="stack" aria-labelledby="imp-res">
          <div className="sec-head"><h2 className="sec" id="imp-res" tabIndex={-1} ref={resRef}>{t('imports.step2')} <span className="small muted mono" style={{ fontWeight: 400 }}>{report.fileName}</span></h2></div>

          {report.fileIssues.map((i, k) => <div key={k} className="alert crit" role="alert"><span className="grow">{msg(i)}</span></div>)}
          {report.fileWarnings.map((i, k) => <div key={k} className="alert warn"><span className="grow">{msg(i)}</span></div>)}

          {!report.fileIssues.length && (
            <>
              <div className="metrics">
                <div className="metric"><span className="lbl">{t('imports.metrics.rows')}</span><span className="val">{report.total}</span></div>
                <div className="metric"><span className="lbl">{t('imports.metrics.create')}</span><span className="val ok">{report.counts.create}</span></div>
                <div className="metric"><span className="lbl">{t('imports.metrics.update')}</span><span className="val">{report.counts.update}</span></div>
                <div className="metric"><span className="lbl">{t('imports.metrics.skip')}</span><span className="val">{report.counts.skip}</span></div>
                <div className="metric"><span className="lbl">{t('imports.metrics.error')}</span><span className={'val' + (report.counts.error ? ' crit' : '')}>{report.counts.error}</span></div>
              </div>

              {done ? (
                <div className="alert ok" role="status">
                  <span className="grow">{t('imports.done', { n: done.written })}</span>
                  <Link className="btn sm" href={TARGET[kind]}>{t('imports.toTarget.' + kind)}</Link>
                  <button type="button" className="btn sm ghost" onClick={() => reset()}>{t('imports.again')}</button>
                </div>
              ) : (
                <div className="imp-actions">
                  {report.counts.error > 0 ? <Checkbox label={t('imports.skipErrors')} checked={skipErrors} onChange={(e) => setSkipErrors(e.target.checked)} /> : <span className="small ok-text">{writable ? t('imports.allValid') : t('imports.nothing')}</span>}
                  <span className="spacer" />
                  <button type="button" className="btn" onClick={exportReport}>{t('imports.report')}</button>
                  <button type="button" className="btn primary" onClick={importNow} disabled={blocked || importing} data-loading={importing || undefined}>{t('imports.submit', { n: writable })}</button>
                </div>
              )}

              <div className="chips" role="group" aria-label={t('imports.filter.label')}>
                {(['all', 'error', 'warn'] as const).map((f) => (
                  <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                    {t('imports.filter.' + f)} <span className="mono muted">{f === 'all' ? report.rows.length : f === 'error' ? report.counts.error : report.rows.filter((r) => r.warnings.length).length}</span>
                  </button>
                ))}
              </div>

              {rows.length > 0 && (
                <div className="tablewrap rwrap">
                  <table className="stable rtable imp-rows">
                    <thead><tr><th className="num">{t('imports.table.line')}</th><th>{t('imports.table.status')}</th><th>{t('imports.table.record')}</th><th>{t('imports.table.messages')}</th></tr></thead>
                    <tbody>
                      {rows.slice(0, SHOW_MAX).map((r) => (
                        <tr key={r.line}>
                          <td className="num" data-label={t('imports.table.line')}>{r.line}</td>
                          <td data-label={t('imports.table.status')}><span className={'tag ' + STATUS_TONE[r.status]}>{t('imports.status.' + r.status)}</span></td>
                          <td className="r-title">{r.label || '–'}</td>
                          <td className="small" data-label={t('imports.table.messages')}>
                            {r.issues.map((i, k) => <span key={'e' + k} className="crit-text" style={{ display: 'block' }}>{msg(i)}</span>)}
                            {r.warnings.map((i, k) => <span key={'w' + k} className="muted" style={{ display: 'block' }}>{msg(i)}</span>)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {rows.length > SHOW_MAX && <p className="small muted" style={{ margin: 0 }}>{t('imports.more', { n: rows.length - SHOW_MAX })}</p>}
            </>
          )}
        </section>
      )}
      {confirmDialog}
    </div>
  )
}
