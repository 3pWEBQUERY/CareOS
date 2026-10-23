'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Tooltip } from '@/components/ui/Tooltip'
import { cellKey, type Cell, type Grid } from '@/lib/roster/model'
import { evaluate, type Issue } from '@/lib/roster/evaluate'
import { saveCellsAction, setPeriodStatusAction, type CellChange } from '../roster-actions'
import { ShiftDialog, type ShiftDraft } from '../_ui/ShiftDialog'
import { ActButton } from '../../team/_ui/ActButton'
import { ProposalBanner } from './ProposalBanner'
import { PatternDialog, PersonDialog, PlanDialog, ShiftTypesDialog } from './RosterDialogs'
import { RosterIssues } from './RosterIssues'
import { issueText } from './format'
import type { RPersonRow, RosterProps } from './types'

type Pos = { r: number; c: number }
type Sel = { active: Pos | null; anchor: Pos | null }
type Change = { key: string; from: Cell; to: Cell }

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
/** Farbklasse einer Dienstart: F/S/N fest, eigene Dienste nach gewählter Farbe. */
const colorOf = (types: Map<string, { color: string }>, code: string) => (['F', 'S', 'N'].includes(code) ? code : 'col-' + (types.get(code)?.color ?? 'accent'))

/**
 * Monatsplanung (PEP-artig): Raster Mitarbeitende × Tage mit Tastatur- und Mausbedienung, Pinsel, Kopieren und
 * Einfügen, Rückgängig, laufender Regelprüfung, Soll/Ist-Stunden und Besetzung. Änderungen werden gesammelt und
 * im Hintergrund gespeichert; Vorschläge (KI, automatisch, Vormonat) erscheinen als Vorschau zum Übernehmen.
 */
export function RosterBoard(props: RosterProps) {
  const { unitId, month, monthLabel, days, types, people, problem, current, shiftAt, absenceAt, wishNote, openByDay, proposal, keyQual } = props
  const t = useT()
  const router = useRouter()
  const tr = (s: string) => (/^[a-z]+\.[\w.]+$/.test(s) ? t(s) : s)

  const [grid, setGrid] = useState<Grid>(current)
  const gridRef = useRef(grid)
  const [sel, setSelState] = useState<Sel>({ active: null, anchor: null })
  const selRef = useRef(sel)
  const setSel = (s: Sel) => { selRef.current = s; setSelState(s) }
  const [brush, setBrush] = useState<string | null | undefined>(undefined)
  const [preview, setPreview] = useState(proposal?.status === 'ready')
  const [saving, setSaving] = useState(false)
  const [dialog, setDialog] = useState<null | 'ai' | 'auto' | 'copy' | 'pattern' | 'types'>(null)
  const [person, setPerson] = useState<RPersonRow | null>(null)
  const [detail, setDetail] = useState<ShiftDraft | null>(null)
  const [, rerender] = useState(0)
  const undo = useRef<Change[][]>([])
  const redo = useRef<Change[][]>([])
  const queue = useRef<Change[]>([])
  const inflight = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clip = useRef<Cell[][] | null>(null)
  const buffer = useRef<{ s: string; h: ReturnType<typeof setTimeout> | null }>({ s: '', h: null })
  const drag = useRef<{ on: boolean; paint: Change[] }>({ on: false, paint: [] })
  const table = useRef<HTMLTableElement>(null)

  // Server-Stand übernehmen, sobald keine eigenen Änderungen unterwegs sind
  useEffect(() => {
    if (!queue.current.length && !inflight.current) { gridRef.current = current; setGrid(current) }
  }, [current])
  useEffect(() => { setPreview(proposal?.status === 'ready') }, [proposal?.id, proposal?.status])
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (queue.current.length || inflight.current) e.preventDefault() }
    const up = () => {
      if (!drag.current.on) return
      drag.current.on = false
      if (drag.current.paint.length) { undo.current.push(drag.current.paint); redo.current = []; rerender((x) => x + 1) }
      drag.current.paint = []
    }
    window.addEventListener('beforeunload', warn)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('pointerup', up) }
  }, [])

  const dayMap = useMemo(() => new Map(days.map((d) => [d.key, d])), [days])
  const typeMap = useMemo(() => new Map(types.map((x) => [x.code, x])), [types])
  const fmt = { days: dayMap, types: typeMap, keyQual }

  const proposed = useMemo(() => {
    if (!preview || proposal?.status !== 'ready') return null
    const g: Grid = { ...grid }
    const changed = new Map<string, Cell>()
    for (const c of proposal.cells) {
      const k = cellKey(c.u, c.d)
      changed.set(k, g[k] ?? null)
      if (c.c) g[k] = c.c
      else delete g[k]
    }
    return { g, changed }
  }, [preview, proposal, grid])
  const shown = proposed?.g ?? grid
  const ev = useMemo(() => evaluate(problem, shown), [problem, shown])
  const issuesAt = useMemo(() => {
    const m = new Map<string, Issue[]>()
    for (const i of ev.issues) if (i.user && i.day && i.code !== 'weekly') {
      const k = cellKey(i.user, i.day)
      m.set(k, [...(m.get(k) ?? []), i])
    }
    return m
  }, [ev])

  const valueAt = (k: string): Cell => (k in problem.locked ? problem.locked[k] : (shown[k] ?? null))
  const keyAt = (p: Pos) => cellKey(people[p.r].id, days[p.c].key)

  // ── Speichern ──
  const flush = async () => {
    timer.current = null
    const batch = queue.current
    queue.current = []
    if (!batch.length) return
    const merged = new Map<string, Change>()
    for (const c of batch) merged.set(c.key, { key: c.key, from: merged.get(c.key)?.from ?? c.from, to: c.to })
    const list = [...merged.values()].filter((c) => c.from !== c.to)
    if (!list.length) return
    const payload: CellChange[] = list.map((c) => {
      const [user, day] = c.key.split('|')
      return { user, day, code: c.to }
    })
    inflight.current++
    setSaving(true)
    const r = await saveCellsAction(unitId, month, payload)
    inflight.current--
    if (!inflight.current && !queue.current.length) setSaving(false)
    if (!r.ok) {
      applyLocal(list.map((c) => ({ key: c.key, from: c.to, to: c.from })))
      toast(tr(r.error), { kind: 'crit' })
    } else if (r.data?.skipped) {
      toast(t('roster.errors.skipped', { n: r.data.skipped }), { kind: 'crit' })
      router.refresh()
    }
  }
  const applyLocal = (changes: Change[]) => {
    const n = { ...gridRef.current }
    for (const c of changes) {
      if (c.to) n[c.key] = c.to
      else delete n[c.key]
    }
    gridRef.current = n
    setGrid(n)
  }
  const commit = (changes: Change[], record = true) => {
    if (!changes.length) return
    applyLocal(changes)
    if (record) {
      undo.current.push(changes)
      if (undo.current.length > 200) undo.current.shift()
      redo.current = []
    }
    queue.current.push(...changes)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, 400)
    setSaving(true)
    rerender((x) => x + 1)
  }

  const blocked = () => {
    if (proposed) { toast(t('roster.cell.previewBlocked')); return true }
    return false
  }
  const changeFor = (k: string, to: Cell): Change | 'locked' | 'absent' | null => {
    if (k in problem.locked) return 'locked'
    if (to && problem.absent[k] === 'approved') return 'absent'
    const from = gridRef.current[k] ?? null
    return from === to ? null : { key: k, from, to }
  }
  const collect = (targets: { k: string; to: Cell }[]) => {
    const out: Change[] = []
    let absent = false
    let locked = false
    for (const { k, to } of targets) {
      const c = changeFor(k, to)
      if (c === 'absent') absent = true
      else if (c === 'locked') locked = true
      else if (c) out.push(c)
    }
    if (absent) toast(t('roster.cell.absenceBlocked'))
    else if (locked && !out.length) toast(t('roster.cell.lockedBlocked'))
    return out
  }
  const rectOf = (s: Sel) => {
    const a = s.active
    const b = s.anchor ?? s.active
    if (!a || !b) return null
    return { r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) }
  }
  const setSelection = (code: Cell) => {
    if (blocked()) return
    const rc = rectOf(selRef.current)
    if (!rc) return
    const targets: { k: string; to: Cell }[] = []
    for (let r = rc.r0; r <= rc.r1; r++) for (let c = rc.c0; c <= rc.c1; c++) targets.push({ k: keyAt({ r, c }), to: code })
    commit(collect(targets))
  }

  const doUndo = () => {
    if (blocked()) return
    const c = undo.current.pop()
    if (!c) return
    redo.current.push(c)
    commit(c.map((x) => ({ key: x.key, from: x.to, to: x.from })).reverse(), false)
  }
  const doRedo = () => {
    if (blocked()) return
    const c = redo.current.pop()
    if (!c) return
    undo.current.push(c)
    commit(c, false)
  }
  const copy = () => {
    const rc = rectOf(selRef.current)
    if (!rc) return
    const m: Cell[][] = []
    for (let r = rc.r0; r <= rc.r1; r++) {
      const row: Cell[] = []
      for (let c = rc.c0; c <= rc.c1; c++) row.push(valueAt(keyAt({ r, c })))
      m.push(row)
    }
    clip.current = m
    navigator.clipboard?.writeText(m.map((row) => row.map((v) => v ?? '').join('\t')).join('\n')).catch(() => {})
  }
  const paste = () => {
    const m = clip.current
    const a = selRef.current.active
    if (!m || !a || blocked()) return
    const targets: { k: string; to: Cell }[] = []
    m.forEach((row, i) => row.forEach((v, j) => {
      const r = a.r + i
      const c = a.c + j
      if (r < people.length && c < days.length) targets.push({ k: keyAt({ r, c }), to: v && typeMap.has(v) ? v : null })
    }))
    commit(collect(targets))
  }
  const typeCode = (ch: string) => {
    const codes = types.map((x) => x.code)
    const b = buffer.current
    if (b.h) clearTimeout(b.h)
    b.h = null
    const s = b.s + ch
    const starts = codes.filter((c) => c.startsWith(s))
    if (!starts.length) {
      b.s = ''
      if (s.length > 1) return typeCode(ch)
      if (ch === 'X') setSelection(null)
      return
    }
    if (starts.length === 1 && starts[0] === s) { b.s = ''; return setSelection(s) }
    b.s = s
    b.h = setTimeout(() => {
      const v = b.s
      b.s = ''
      if (codes.includes(v)) setSelection(v)
    }, 700)
  }
  const openDetail = (p: Pos) => {
    if (blocked()) return
    const k = keyAt(p)
    const meta = shiftAt[k]
    const v = valueAt(k)
    if (k in problem.locked) return void toast(t('roster.cell.lockedBlocked'))
    if (meta && !meta.unit && v && typeMap.get(v)?.id === meta.typeId) setDetail({ id: meta.id, typeId: meta.typeId, userId: people[p.r].id, date: days[p.c].key, req: meta.req, note: meta.note })
    else if (!v) setDetail({ userId: people[p.r].id, date: days[p.c].key })
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (!people.length) return
    const pos = selRef.current.active ?? { r: 0, c: 0 }
    const mod = e.ctrlKey || e.metaKey
    const move = (dr: number, dc: number) => {
      e.preventDefault()
      const n = { r: clamp(pos.r + dr, 0, people.length - 1), c: clamp(pos.c + dc, 0, days.length - 1) }
      setSel({ active: n, anchor: e.shiftKey ? (selRef.current.anchor ?? pos) : n })
      document.getElementById(`rc-${n.r}-${n.c}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    switch (e.key) {
      case 'ArrowUp': return move(-1, 0)
      case 'ArrowDown': return move(1, 0)
      case 'ArrowLeft': return move(0, -1)
      case 'ArrowRight': return move(0, 1)
      case 'Home': return move(0, -pos.c)
      case 'End': return move(0, days.length - 1 - pos.c)
      case 'Escape': setSel({ active: pos, anchor: pos }); setBrush(undefined); return
      case 'Delete': case 'Backspace': e.preventDefault(); return setSelection(null)
      case 'Enter': e.preventDefault(); return openDetail(pos)
    }
    if (mod) {
      const k = e.key.toLowerCase()
      if (k === 'z') { e.preventDefault(); return e.shiftKey ? doRedo() : doUndo() }
      if (k === 'y') { e.preventDefault(); return doRedo() }
      if (k === 'c') { e.preventDefault(); return copy() }
      if (k === 'v') { e.preventDefault(); return paste() }
      return
    }
    if (e.altKey) return
    if (e.key === '-') { e.preventDefault(); return setSelection(null) }
    if (/^[a-z0-9]$/i.test(e.key)) { e.preventDefault(); typeCode(e.key.toUpperCase()) }
  }

  const paintAt = (p: Pos) => {
    if (brush === undefined) return
    if (blocked()) { drag.current.on = false; return }
    const c = changeFor(keyAt(p), brush)
    if (c === 'absent') return void toast(t('roster.cell.absenceBlocked'))
    if (!c || c === 'locked') return
    drag.current.paint.push(c)
    commit([c], false)
  }
  const onDown = (e: React.PointerEvent, p: Pos) => {
    if (e.button !== 0) return
    table.current?.focus({ preventScroll: true })
    if (e.shiftKey && selRef.current.active) return setSel({ active: p, anchor: selRef.current.anchor ?? selRef.current.active })
    setSel({ active: p, anchor: p })
    drag.current = { on: true, paint: [] }
    paintAt(p)
  }
  const onEnter = (p: Pos) => {
    if (!drag.current.on) return
    if (brush !== undefined) paintAt(p)
    else setSel({ active: p, anchor: selRef.current.anchor })
  }
  const goTo = (userId: string, day: string) => {
    const r = people.findIndex((x) => x.id === userId)
    const c = days.findIndex((d) => d.key === day)
    if (r < 0) return
    const p = { r, c: c < 0 ? 0 : c }
    setSel({ active: p, anchor: p })
    const el = document.getElementById(`rc-${p.r}-${p.c}`)
    el?.scrollIntoView({ block: 'center', inline: 'center' })
    table.current?.focus({ preventScroll: true })
  }

  // ── Anzeige ──
  const rc = rectOf(sel)
  const describe = (p: Pos) => {
    const person = people[p.r]
    const day = days[p.c]
    const k = keyAt(p)
    const v = valueAt(k)
    const ty = v ? typeMap.get(v) : undefined
    const parts = [person.name, day.label, ty ? `${ty.code} · ${ty.name} ${ty.start}–${ty.end}` : t('roster.cell.free')]
    const meta = shiftAt[k]
    if (meta?.unit) parts.push(t('roster.cell.foreign', { unit: meta.unit }))
    else if (meta?.status === 'swap_requested') parts.push(t('roster.cell.swap'))
    else if (day.past) parts.push(t('roster.cell.past'))
    const abs = absenceAt[k]
    if (abs) parts.push(abs.pending ? t('roster.cell.absencePending', { kind: abs.title }) : abs.title)
    const w = problem.wishes[k]
    if (w) parts.push(w.kind === 'off' ? t('roster.cell.wishOff') : t('roster.cell.wishShift', { shift: typeMap.get(w.code)?.name ?? w.code }) + (wishNote[k] ? ` («${wishNote[k]}»)` : ''))
    if (proposed?.changed.has(k)) parts.push(t('roster.cell.changed', { from: proposed.changed.get(k) ?? t('roster.cell.free') }))
    for (const i of issuesAt.get(k) ?? []) if (i.code !== 'wish') parts.push((i.severity === 'error' ? '▲ ' : '') + issueText(t, i, fmt))
    return parts.join(' · ')
  }
  const status = sel.active && people[sel.active.r] ? describe(sel.active) : t('roster.grid.keys')

  const cell = (r: number, c: number) => {
    const p = people[r]
    const d = days[c]
    const k = cellKey(p.id, d.key)
    const v = valueAt(k)
    const meta = shiftAt[k]
    const abs = absenceAt[k]
    const w = problem.wishes[k]
    const iss = issuesAt.get(k)
    const err = iss?.some((i) => i.severity === 'error')
    const warn = iss?.some((i) => i.code === 'pending')
    const inSel = !!rc && r >= rc.r0 && r <= rc.r1 && c >= rc.c0 && c <= rc.c1
    const act = sel.active?.r === r && sel.active?.c === c
    const cls = ['rc', v && 'c-' + colorOf(typeMap, v), d.weekend && 'we', d.today && 'td', k in problem.locked && 'lk', meta?.unit && 'fg', abs && !v && 'ab', abs?.pending && 'abp',
      w && 'w-' + w.kind, w?.kind === 'shift' && v === w.code && 'w-met', err && 'err', !err && warn && 'warn', proposed?.changed.has(k) && 'chg', inSel && 'sel', act && 'act'].filter(Boolean).join(' ')
    const label = `${p.short}, ${d.label}: ${v ? (typeMap.get(v)?.name ?? v) : abs ? abs.title : t('roster.cell.free')}${err ? ' ▲' : ''}`
    return (
      <td key={d.key} id={`rc-${r}-${c}`} className={cls} aria-selected={inSel || undefined} aria-label={label}
        onPointerDown={(e) => onDown(e, { r, c })} onPointerEnter={() => onEnter({ r, c })} onDoubleClick={() => openDetail({ r, c })}>
        {v ? <>{v}{meta?.unit ? <small>{meta.unit}</small> : null}{meta?.status === 'swap_requested' ? <small>⇄</small> : null}</> : abs ? <span className="rc-abs">{abs.label}</span> : null}
      </td>
    )
  }

  const editable = props.canPlan
  const staff = people.map((x) => ({ id: x.id, name: x.name, qual: x.qual }))

  return (
    <div className="roster stack-sm">
      <div className="rst-head no-print">
        <span className={'tag ' + (props.period === 'draft' ? 'warn' : 'ok')}>{t('roster.period.' + props.period)}</span>
        <span className="small muted">{t(props.period === 'draft' ? 'roster.period.draftHint' : 'roster.period.releasedHint')}</span>
        <span className="spacer" />
        {props.canEditTypes && <button type="button" className="btn sm ghost" onClick={() => setDialog('types')}>{t('roster.types.button')}</button>}
        <button type="button" className="btn sm ghost" onClick={() => window.print()}>{t('roster.tools.print')}</button>
        {props.period === 'draft' ? (
          <ActButton action={() => setPeriodStatusAction(unitId, month, 'released')} className="btn sm primary" confirm={`${t('roster.period.releaseConfirm', { month: monthLabel })} ${t('roster.period.releaseBody')}`}>{t('roster.period.release')}</ActButton>
        ) : editable ? (
          <ActButton action={() => setPeriodStatusAction(unitId, month, 'draft')} className="btn sm ghost" confirm={`${t('roster.period.toDraftConfirm', { month: monthLabel })} ${t('roster.period.toDraftBody')}`}>{t('roster.period.toDraft')}</ActButton>
        ) : null}
      </div>

      {proposal && <ProposalBanner proposal={proposal} monthLabel={monthLabel} preview={preview} onPreview={setPreview} onRetry={() => setDialog(proposal.source)} />}

      <div className="rst-bar no-print" role="toolbar" aria-label={t('roster.tools.palette')}>
        <div className="seg" role="group" aria-label={t('roster.tools.palette')}>
          <button type="button" aria-pressed={brush === undefined} onClick={() => setBrush(undefined)}>{t('roster.tools.select')}</button>
          {types.map((x) => (
            <Tooltip key={x.id} content={`${x.name} ${x.start}–${x.end}`}>
              <button type="button" aria-pressed={brush === x.code} aria-label={`${t('roster.tools.palette')}: ${x.name}`} onClick={() => setBrush((b) => (b === x.code ? undefined : x.code))}><span className={'sh ' + colorOf(typeMap, x.code)}>{x.code}</span></button>
            </Tooltip>
          ))}
          <button type="button" aria-pressed={brush === null} onClick={() => setBrush((b) => (b === null ? undefined : null))}>{t('roster.tools.free')}</button>
        </div>
        <Tooltip content={`${t('roster.tools.undo')} · Strg+Z`}><button type="button" className="btn sm ghost" aria-label={t('roster.tools.undo')} disabled={!undo.current.length} onClick={doUndo}>↶</button></Tooltip>
        <Tooltip content={`${t('roster.tools.redo')} · Strg+Y`}><button type="button" className="btn sm ghost" aria-label={t('roster.tools.redo')} disabled={!redo.current.length} onClick={doRedo}>↷</button></Tooltip>
        <span className="small muted" role="status">{saving ? t('roster.tools.saving') : t('roster.tools.saved')}</span>
        <span className="spacer" />
        {editable && (
          <>
            {props.ai.available ? (
              <button type="button" className="btn sm primary" onClick={() => setDialog('ai')}>{t('roster.tools.ai')}</button>
            ) : (
              <Tooltip content={tr(props.ai.reason ?? 'roster.ai.off')}>
                <button type="button" className="btn sm primary" aria-disabled onClick={() => toast(tr(props.ai.reason ?? 'roster.ai.off'))}>{t('roster.tools.ai')}</button>
              </Tooltip>
            )}
            <button type="button" className="btn sm" onClick={() => setDialog('auto')}>{t('roster.tools.auto')}</button>
            <button type="button" className="btn sm ghost" onClick={() => setDialog('copy')}>{t('roster.tools.copy')}</button>
          </>
        )}
        <button type="button" className="btn sm ghost" onClick={() => setDialog('pattern')}>{t('roster.tools.pattern')}</button>
      </div>

      <h2 className="print-only">{t('roster.grid.label', { month: monthLabel })}</h2>
      <div className="rst-wrap">
        <table ref={table} className={'rst' + (brush !== undefined ? ' painting' : '')} role="grid" tabIndex={0} aria-label={t('roster.grid.label', { month: monthLabel })}
          aria-activedescendant={sel.active ? `rc-${sel.active.r}-${sel.active.c}` : undefined} aria-describedby="rst-status"
          onKeyDown={onKey} onFocus={() => { if (!selRef.current.active && people.length) { const c = Math.max(0, days.findIndex((d) => !d.past)); setSel({ active: { r: 0, c }, anchor: { r: 0, c } }) } }}>
          <thead>
            <tr>
              <th scope="col" className="rst-name">{t('roster.grid.person')}</th>
              {days.map((d) => <th key={d.key} scope="col" className={'rst-day' + (d.weekend ? ' we' : '') + (d.today ? ' td' : '')} aria-label={d.label}><span>{d.wd}</span><span>{d.dom}</span></th>)}
              <th scope="col" className="rst-sum">{t('roster.grid.soll')}</th>
              <th scope="col" className="rst-sum">{t('roster.grid.ist')}</th>
              <th scope="col" className="rst-sum">{t('roster.grid.diff')}</th>
              <th scope="col" className="rst-sum" title={t('roster.grid.nightsTitle')}>{t('roster.grid.nights')}</th>
              <th scope="col" className="rst-sum" title={t('roster.grid.weekendsTitle')}>{t('roster.grid.weekends')}</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p, r) => {
              const head = r === 0 || people[r - 1].group !== p.group
              const count = head ? people.filter((x) => x.group === p.group).length : 0
              const s = ev.people[p.id]
              const off = s && Math.abs(s.diff) > Math.max(8, s.soll * 0.1)
              return (
                <Fragment key={p.id}>
                {head && (
                  <tr className="rst-group">
                    <th scope="colgroup" colSpan={days.length + 6}><span className="rst-gl">{p.group} <span className="muted">{count}</span></span></th>
                  </tr>
                )}
                <tr>
                  <th scope="row" className="rst-name">
                    <button type="button" className="rst-person" onClick={() => setPerson(p)} aria-label={t('roster.grid.editPerson', { name: p.name })}>
                      <span className="ellipsis">{p.name}{p.key ? ' *' : ''}</span>
                      <span className="small muted ellipsis">{p.pct} % · {p.qual || p.job}</span>
                    </button>
                  </th>
                  {days.map((_, c) => cell(r, c))}
                  <td className="rst-sum num">{s?.soll}</td>
                  <td className="rst-sum num">{s?.ist}</td>
                  <td className={'rst-sum num' + (off ? (s.diff < 0 ? ' warn-text' : ' crit-text') : '')}>{s ? (s.diff > 0 ? '+' : '') + s.diff : ''}</td>
                  <td className="rst-sum num">{s?.nights}</td>
                  <td className="rst-sum num">{s?.weekends}</td>
                </tr>
                </Fragment>
              )
            })}
          </tbody>
          <tfoot>
            {types.map((x) => (
              <tr key={x.id}>
                <th scope="row" className="rst-name"><span className={'sh ' + colorOf(typeMap, x.code)}>{x.code}</span> <span className="small">{t('roster.grid.coverage')}</span></th>
                {days.map((d) => {
                  const cv = ev.coverage[d.key]?.[x.code]
                  const open = openByDay[d.key]?.[x.code] ?? 0
                  if (!cv) return <td key={d.key} />
                  const state = cv.n < cv.target ? 'under' : cv.n > cv.target ? 'over' : 'ok'
                  return <td key={d.key} className={'rst-cov ' + state + (d.weekend ? ' we' : '')} title={t('schedule.coverage.cell', { code: x.code, n: cv.n, target: cv.target }) + (open ? ` · ${t('schedule.coverage.openLine', { n: open })}` : '')}>{cv.n}<small>/{cv.target}</small>{open ? <i aria-hidden="true">+{open}</i> : null}</td>
                })}
                <td colSpan={5} />
              </tr>
            ))}
            {keyQual && ev.hasKeyQual && (
              <tr>
                <th scope="row" className="rst-name"><span className="small ellipsis">{keyQual}</span></th>
                {days.map((d) => {
                  const missing = types.filter((x) => { const cv = ev.coverage[d.key]?.[x.code]; return cv && cv.target > 0 && cv.n > 0 && !cv.key }).map((x) => x.code)
                  if (!types.some((x) => (ev.coverage[d.key]?.[x.code]?.n ?? 0) > 0)) return <td key={d.key} className={'rst-cov' + (d.weekend ? ' we' : '')} />
                  return <td key={d.key} className={'rst-cov ' + (missing.length ? 'under' : 'ok') + (d.weekend ? ' we' : '')} title={missing.length ? t('schedule.coverage.qualMissing', { qual: keyQual }) + ': ' + missing.join(' ') : t('schedule.coverage.qualOk', { qual: keyQual })}>{missing.length ? missing.join('') : '✓'}</td>
                })}
                <td colSpan={5} />
              </tr>
            )}
          </tfoot>
        </table>
        {!people.length && <p className="muted small" style={{ padding: 16 }}>{t('roster.grid.empty')}</p>}
      </div>
      <p id="rst-status" className="rst-status small no-print" aria-live="polite">{status}</p>
      <div className="mlegend no-print">
        {types.map((x) => <span key={x.id}><span className={'sh ' + colorOf(typeMap, x.code)}>{x.code}</span> {x.name} <span className="mono">{x.start}–{x.end} · {x.hours} h</span></span>)}
        <span><span className="rc-key w-off" aria-hidden="true" /> {t('roster.legend.wish')}</span>
        <span><span className="rc-key chg" aria-hidden="true" /> {t('roster.legend.changed')}</span>
        <span><span className="rc-key err" aria-hidden="true" /> {t('roster.legend.violation')}</span>
        <span><span className="rc-key fg" aria-hidden="true" /> {t('roster.legend.foreign')}</span>
        {keyQual && <span>* {keyQual}</span>}
      </div>

      <RosterIssues issues={ev.issues} people={people} fmt={fmt} onShow={goTo} />

      {dialog === 'types' && <ShiftTypesDialog onClose={() => setDialog(null)} types={types} weekdays={props.weekdays} />}
      {(dialog === 'ai' || dialog === 'auto' || dialog === 'copy') && (
        <PlanDialog source={dialog} onClose={() => setDialog(null)} unitId={unitId} month={month} defaultMode={Object.keys(current).length ? 'fill' : 'replace'} />
      )}
      {dialog === 'pattern' && (
        <PatternDialog onClose={() => setDialog(null)} people={people} days={days} types={types} monthLabel={monthLabel}
          initial={sel.active ? { userId: people[sel.active.r]?.id, day: days[sel.active.c]?.key } : undefined}
          onApply={(targets) => {
            if (blocked()) return 0
            const ch = collect(targets.map((x) => ({ k: cellKey(x.user, x.day), to: x.code })).filter((x) => !(x.k in problem.locked) && !problem.absent[x.k]))
            commit(ch)
            return ch.length
          }} />
      )}
      {person && <PersonDialog person={person} unitId={unitId} types={types} onClose={() => setPerson(null)} />}
      <ShiftDialog draft={detail} onClose={() => setDetail(null)} types={types.map((x) => ({ id: x.id, code: x.code, name: x.name, start: x.start, end: x.end }))} staff={staff} quals={props.quals} unitId={unitId} />
    </div>
  )
}
