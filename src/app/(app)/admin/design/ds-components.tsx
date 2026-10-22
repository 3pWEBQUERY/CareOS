'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLocale, useT } from '@/i18n/client'
import { fmtNum } from '@/lib/time'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { Empty } from '@/components/ui/Empty'
import { NotFoundState } from '@/components/ui/ErrorState'
import { BarChart } from '@/components/ui/BarChart'
import { LineChart } from '@/components/ui/LineChart'
import { Bar, Block, SkelList, SkelMetrics, SkelTable } from '@/components/ui/Skeleton'
import { TaskTable, type TaskRowDto } from '@/components/tasks/TaskTable'
import { HandoverCard, type HoBlockDto } from '@/components/handover/HandoverUi'
import {
  Checkbox, CheckboxGroup, ColorField, Combobox, DateField, DateTimeField, FileField, NumberField, RadioGroup, SearchField,
  SegmentedControl, Select, Switch, TextField, Textarea, TimeField,
} from '@/components/ui/fields'

/** Alle Feld-Komponenten mit typischer Konfiguration. Absenden zeigt nur Laden und Erfolg – nichts wird übertragen. */
export function FieldGallery() {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const people = [
    { value: 'r1', label: 'Keller Rosa', hint: t('design.ex.room', { n: '12' }), group: 'Wohngruppe 1' },
    { value: 'r2', label: 'Brunner Hans', hint: t('design.ex.room', { n: '14' }), group: 'Wohngruppe 1' },
    { value: 'r3', label: 'Meier Elsa', hint: t('design.ex.room', { n: '21' }), group: 'Wohngruppe 2' },
    { value: 'r4', label: 'Rossi Lucia', hint: t('design.ex.room', { n: '23' }), group: 'Wohngruppe 2' },
  ]
  return (
    <form
      className="card ds-form"
      aria-label={t('design.sec.fields')}
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        setBusy(true)
        setTimeout(() => { setBusy(false); toast(t('design.fields.savedDemo')) }, 1200)
      }}
    >
      <div className="card-body">
        <div className="form-grid">
          <TextField label={t('design.fields.name')} name="name" required hint={t('design.fields.nameHint')} maxLength={120} />
          <TextField label={t('design.fields.email')} name="email" type="email" optional autoComplete="off" />
          <TextField label={t('design.fields.password')} name="pw" type="password" autoComplete="new-password" />
          <SearchField label={t('design.fields.search')} name="q" placeholder={t('design.fields.searchPh')} />
          <NumberField label={t('design.fields.temp')} name="temp" unit="°C" min={30} max={45} step={0.1} warn={{ lo: 35.5, hi: 38 }} hint={t('design.fields.tempHint')} />
          <NumberField label={t('design.fields.dose')} name="dose" unit="mg" min={0} max={2000} step={1} />
          <Select label={t('design.fields.unit')} name="unit" placeholder={t('design.fields.choose')}>
            <option value="wg1">Wohngruppe 1</option>
            <option value="wg2">Wohngruppe 2</option>
          </Select>
          <Combobox label={t('design.fields.person')} name="person" options={people} placeholder={t('design.fields.personPh')} clearable hint={t('design.fields.personHint')} />
          <DateField label={t('design.fields.date')} name="date" />
          <TimeField label={t('design.fields.time')} name="time" />
          <DateTimeField label={t('design.fields.dateTime')} name="at" wrapClassName="span-all" />
          <Textarea label={t('design.fields.note')} name="note" rows={3} maxLength={500} counter wrapClassName="span-all" />
          <RadioGroup label={t('design.fields.mobility')} name="mob" options={[{ value: 'a', label: t('design.ex.mobA') }, { value: 'b', label: t('design.ex.mobB'), hint: t('design.ex.mobBHint') }, { value: 'c', label: t('design.ex.mobC') }]} />
          <div className="stack-sm">
            <SegmentedControl label={t('design.fields.shift')} name="shift" defaultValue="f" options={[{ value: 'f', label: t('design.ex.early') }, { value: 's', label: t('design.ex.late') }, { value: 'n', label: t('design.ex.night') }]} />
            <Checkbox name="consent" label={t('design.fields.consent')} />
            <Switch name="push" label={t('design.fields.push')} hint={t('design.fields.pushHint')} defaultChecked />
          </div>
          <CheckboxGroup label={t('design.fields.roles')} name="roles" defaultValue={['care']} options={[{ value: 'care', label: t('design.ex.roleCare') }, { value: 'lead', label: t('design.ex.roleLead') }, { value: 'qm', label: t('design.ex.roleQm') }]} />
          <RadioGroup label={t('design.fields.cards')} name="cards" variant="card" defaultValue="0" options={[{ value: '0', label: t('design.ex.card0'), hint: '0' }, { value: '1', label: t('design.ex.card1'), hint: '1' }]} />
          <FileField label={t('design.fields.file')} name="file" accept="image/*,.pdf" optional wrapClassName="span-all" />
          <ColorField label={t('design.fields.color')} name="color" defaultValue="#0B5F74" />
        </div>
      </div>
      <div className="card-foot form-actions">
        <span className="small muted">{t('design.fields.demoHint')}</span>
        <span className="spacer" />
        <button type="reset" className="btn ghost">{t('design.fields.reset')}</button>
        <button type="submit" className="btn primary" data-loading={busy || undefined} disabled={busy}>{t('common.save')}</button>
      </div>
    </form>
  )
}

/** Karten, Kennzahlen, Tabellen, Listen, Timeline. */
export function DataDisplay() {
  const t = useT()
  const locale = useLocale()
  const n = (v: number, d = 1) => fmtNum(v, d, locale)
  return (
    <div className="stack">
      <div className="metrics">
        <div className="metric"><span className="lbl">{t('design.ex.mResidents')}</span><span className="val">18</span></div>
        <div className="metric"><span className="lbl">{t('design.ex.mCritical')}</span><span className="val crit">2</span><span className="small crit-text">▲ {t('design.ex.mCriticalHint')}</span></div>
        <div className="metric"><span className="lbl">{t('design.ex.mDue')}</span><span className="val warn">5</span></div>
        <div className="metric"><span className="lbl">{t('design.ex.mHandover')}</span><span className="val">12 <small>/ 18</small></span><div className="bar"><i style={{ width: '67%' }} /></div></div>
      </div>

      <div className="grid-3">
        <section className="card" aria-labelledby="ds-c1">
          <div className="card-head"><h3 id="ds-c1">{t('design.ex.cardTitle')}</h3><button type="button" className="btn sm">{t('design.buttons.open')}</button></div>
          <div className="card-body small">{t('design.ex.cardBody')}</div>
          <div className="card-foot small muted">.card · .card-head · .card-body · .card-foot</div>
        </section>
        <section className="card warn" aria-labelledby="ds-c2">
          <div className="card-head"><h3 id="ds-c2">{t('design.ex.cardWarn')}</h3><span className="tag warn">{t('design.status.ex.attentionTag')}</span></div>
          <div className="card-body small">.card.warn</div>
        </section>
        <section className="card crit" aria-labelledby="ds-c3">
          <div className="card-head"><h3 id="ds-c3">{t('design.ex.cardCrit')}</h3><span className="tag crit">{t('design.status.ex.criticalTag')}</span></div>
          <div className="card-body small">.card.crit</div>
        </section>
      </div>

      <div className="grid-2">
        <div className="tablewrap">
          <table className="stable">
            <caption className="sr-only">{t('design.ex.tableCaption')}</caption>
            <thead><tr><th scope="col">{t('design.ex.colTime')}</th><th scope="col">{t('design.ex.colPerson')}</th><th scope="col">{t('design.ex.colTask')}</th><th scope="col" className="right">{t('design.ex.colMin')}</th></tr></thead>
            <tbody>
              <tr className="over"><td className="mono">07:00</td><td>Keller Rosa</td><td>{t('design.ex.task1')} <span className="tag crit">{t('design.status.ex.criticalTag')}</span></td><td className="num right">10</td></tr>
              <tr><td className="mono">08:00</td><td>Brunner Hans</td><td>{t('design.ex.task2')}</td><td className="num right">15</td></tr>
              <tr><td className="mono">09:30</td><td>Meier Elsa</td><td>{t('design.ex.task3')}</td><td className="num right">5</td></tr>
            </tbody>
          </table>
        </div>
        <div className="tablewrap">
          <table className="vt">
            <caption className="sr-only">{t('design.ex.vitalsCaption')}</caption>
            <thead><tr><th scope="col">{t('design.ex.colTime')}</th><th scope="col">{t('design.ex.temp')}</th><th scope="col">{t('design.ex.pulse')}</th><th scope="col">{t('design.ex.spo2')}</th></tr></thead>
            <tbody>
              <tr><td className="num">06:40</td><td className="num hi">{n(38.4)} °C</td><td className="num">88</td><td className="num lo">87 %</td></tr>
              <tr><td className="num">{t('common.yesterday')} 18:10</td><td className="num">{n(37.1)} °C</td><td className="num">76</td><td className="num">95 %</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid-2">
        <ol className="timeline" aria-label={t('design.ex.shiftTimeline')}>
          <li className="trow is-done"><span className="t mono">06:30</span><span /><div style={{ minWidth: 0 }}><div className="ttl">{t('design.ex.task2')}</div><div className="sub">{t('design.ex.allDone')}</div></div><span className="tag">{t('design.ex.catCare')}</span><span className="mins mono">15′</span></li>
          <li className="trow is-over"><span className="t mono">07:00</span><span /><div style={{ minWidth: 0 }}><div className="ttl">{t('design.ex.task1')}</div><div className="sub">Keller Rosa · <span className="tag crit">{t('design.status.ex.criticalTag')}</span></div></div><span className="tag">{t('design.ex.catMed')}</span><span className="mins mono">10′</span></li>
          <li className="now" aria-label={t('design.ex.now', { time: '07:12' })}><span>07:12</span><i /></li>
          <li className="trow is-due"><span className="t mono">07:30</span><span /><div style={{ minWidth: 0 }}><div className="ttl">{t('design.ex.task3')}</div><div className="sub">Meier Elsa · {t('design.ex.dueNow')}</div></div><span className="tag">{t('design.ex.catCare')}</span><span className="mins mono">5′</span></li>
          <li className="trow"><span className="t mono">09:00</span><span /><div style={{ minWidth: 0 }}><div className="ttl">{t('design.ex.task4')}</div><div className="sub">Brunner Hans</div></div><span className="tag">{t('design.ex.catCare')}</span><span className="mins mono">20′</span></li>
        </ol>
        <ol className="events" aria-label={t('design.ex.residentTimeline')}>
          <li className="day-sep">{t('common.today')}</li>
          <li className="event"><time className="mono">06:40</time><span className="dot crit" aria-hidden="true" /><div className="body"><div className="row" style={{ gap: 8 }}><span className="tag crit">{t('design.ex.evVitals')}</span><span>SpO₂ 87 % ▼</span><span className="small muted">A. Muster</span></div></div></li>
          <li className="event"><time className="mono">06:15</time><span className="dot ok" aria-hidden="true" /><div className="body"><div className="row" style={{ gap: 8 }}><span className="tag ok">{t('design.ex.evMed')}</span><span>{t('design.ex.evMedText')}</span></div></div></li>
          <li className="day-sep">{t('common.yesterday')}</li>
          <li className="event"><time className="mono">21:30</time><span className="dot accent" aria-hidden="true" /><div className="body"><div className="row" style={{ gap: 8 }}><span className="tag accent">{t('design.ex.evNote')}</span><span className="small muted">L. Rohner</span></div><p>{t('design.ex.evNoteText')}</p></div></li>
        </ol>
      </div>

      <div className="grid-2">
        <ul className="list card" aria-label={t('design.ex.listLabel')}>
          <li><a className="li unread" href="#ds-data"><div className="grow"><div>{t('design.ex.list1')}</div><div className="small muted">{t('common.today')} 07:05</div></div><span className="tag accent">{t('design.status.ex.infoTag')}</span></a></li>
          <li><a className="li" href="#ds-data"><div className="grow"><div>{t('design.ex.list2')}</div><div className="small muted">{t('common.yesterday')} 16:40</div></div></a></li>
        </ul>
        <dl className="kv card card-body">
          <dt>{t('design.ex.kvRoom')}</dt><dd className="mono">12</dd>
          <dt>{t('design.ex.kvMobility')}</dt><dd>{t('design.ex.mobB')}</dd>
          <dt>{t('design.ex.kvDiet')}</dt><dd>{t('design.ex.kvDietValue')}</dd>
        </dl>
      </div>
    </div>
  )
}

const ROW_BASE = { day: null, description: null, category: '', catTone: '', durationMin: 10, due: '2026-10-22T07:00:00.000Z', completed: null, note: null, createdBy: null, sourceLabel: '', link: null, series: null }

/** Personenkopf, klinische Warnungen, Aufgabenzeile, Übergabekarte (Beispieldaten, ohne Wirkung). */
export function Clinical() {
  const t = useT()
  const rows: TaskRowDto[] = [
    { ...ROW_BASE, id: 'ds-t1', time: '07:00', title: t('design.ex.task1'), category: t('design.ex.catMed'), catTone: 'violet', priority: 'critical', view: 'over', resident: { id: 'ds-r1', name: 'Keller Rosa', room: '12' }, assignee: { id: 'ds-u1', initials: 'AM', name: 'Anna Muster' } },
    { ...ROW_BASE, id: 'ds-t2', time: '07:30', title: t('design.ex.task3'), category: t('design.ex.catCare'), catTone: 'accent', durationMin: 5, priority: 'important', view: 'due', resident: { id: 'ds-r3', name: 'Meier Elsa', room: '15' }, assignee: null },
    { ...ROW_BASE, id: 'ds-t3', time: '08:00', title: t('design.ex.task2'), category: t('design.ex.catCare'), catTone: 'accent', durationMin: 15, priority: 'routine', view: 'in_progress', resident: { id: 'ds-r2', name: 'Brunner Hans', room: '14' }, assignee: { id: 'ds-u2', initials: 'LR', name: 'Lea Rohner' } },
    { ...ROW_BASE, id: 'ds-t4', time: '06:30', title: t('design.ex.task4'), category: t('design.ex.catCare'), catTone: 'accent', priority: 'routine', view: 'done', completed: t('design.ex.completed'), resident: { id: 'ds-r2', name: 'Brunner Hans', room: '14' }, assignee: null },
    { ...ROW_BASE, id: 'ds-t5', time: '06:00', title: t('design.ex.task5'), category: t('design.ex.catCare'), catTone: 'accent', priority: 'routine', view: 'partial', note: t('design.ex.partialNote'), resident: { id: 'ds-r1', name: 'Keller Rosa', room: '12' }, assignee: null },
  ]
  const ho = (o: Partial<HoBlockDto> & { resident: HoBlockDto['resident'] }): HoBlockDto => ({
    cols: { happened: [], done: [], watch: [], open: [] }, more: { happened: 0, done: 0, watch: 0, open: 0 }, entry: null, acked: null, others: [], ...o,
  })
  const target = { shiftCode: 'F', date: '2026-10-22' }
  return (
    <div className="stack">
      <section className="card" aria-label={t('design.ex.residentHeader')}>
        <div className="banner">
          <div className="who">
            {/* Beispiel des Personenkopfs: echtes .banner h1, ohne zweite Überschrift der Seite */}
            <h1 role="presentation">Keller Rosa <span>{t('design.ex.born')}</span></h1>
            <div className="facts">
              <div className="fact"><span className="lbl">{t('design.ex.kvRoom')}</span><span className="v mono">12</span></div>
              <div className="fact"><span className="lbl">{t('design.ex.age')}</span><span className="v mono">87</span></div>
              <div className="fact"><span className="lbl">{t('design.ex.kvMobility')}</span><span className="v">{t('design.ex.mobB')}</span></div>
            </div>
          </div>
          <div className="flags">
            <span className="flag crit">{t('design.status.ex.criticalFlag')}</span>
            <span className="flag warn">{t('design.status.ex.attentionFlag')}</span>
            <span className="flag rea-no">{t('design.ex.reaNo')}</span>
          </div>
        </div>
      </section>

      <div className="grid-2">
        <div className="alert crit" role="note">
          <div className="grow"><strong>{t('design.ex.alertTitle')}</strong><span className="fg">{t('design.ex.alertText')}</span></div>
          <button type="button" className="btn sm danger">{t('design.ex.escalate')}</button>
        </div>
        <div className="stack-sm">
          <div className="dlg-context"><strong>Keller Rosa</strong><span className="mono">{t('design.ex.room', { n: '12' })}</span></div>
          <div className="ai-box">
            <div className="ai-head"><span className="tag violet">{t('common.ai.badge')}</span><span>{t('common.ai.disclaimer')}</span></div>
            <div className="ai-text">{t('design.ex.aiText')}</div>
          </div>
        </div>
      </div>

      <TaskTable rows={rows} staff={[]} canManage={false} canComplete={false} meId="ds-u1" emptyText={t('design.ex.noTasks')} />

      <div className="ho-list">
        <HandoverCard canAck canEdit={false} target={target} b={ho({
          resident: { id: 'ds-r2', name: 'Brunner Hans', room: '14', meta: '87', allergies: [] },
          cols: { happened: [{ text: t('design.ex.hoHappened'), time: '02:10' }], done: [{ text: t('design.ex.task4') }], watch: [], open: [{ text: t('design.ex.hoOpen'), tone: 'w' }] },
          acked: '07:12', others: ['L. Rohner'],
        })} />
        <HandoverCard canAck={false} canEdit={false} target={target} b={ho({
          resident: { id: 'ds-r1', name: 'Keller Rosa', room: '12', meta: '91', allergies: ['Penicillin'] },
          cols: { happened: [{ text: 'SpO₂ 87 % ▼', time: '06:40', tone: 'c', flag: t('design.status.ex.criticalTag') }], done: [], watch: [{ text: t('design.ex.hoWatch'), tone: 'w' }], open: [] },
          entry: { watch: t('design.ex.hoWatch'), open: null, important: true, author: 'A. Muster' },
        })} />
      </div>
    </div>
  )
}

/** Dialog, Bestätigung, Schublade, Command Palette. */
export function Overlays() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [ask, confirmNode] = useConfirm()
  return (
    <div className="grid-2">
      <section className="card" aria-labelledby="ds-o1">
        <div className="card-head"><h3 id="ds-o1">{t('design.ov.modal')}</h3></div>
        <div className="card-body stack-sm">
          <p className="small fg2" style={{ margin: 0 }}>{t('design.ov.modalHint')}</p>
          <div className="row">
            <button type="button" className="btn" onClick={() => setOpen(true)}>{t('design.ov.openDialog')}</button>
            <button type="button" className="btn danger" onClick={async () => {
              if (await ask({ title: t('design.ov.confirmTitle'), text: t('design.ov.confirmText'), context: <><strong>Keller Rosa</strong><span className="mono">{t('design.ex.room', { n: '12' })}</span></>, danger: true, confirmLabel: t('design.buttons.delete') })) toast(t('design.ov.confirmed'))
            }}>{t('design.ov.openConfirm')}</button>
          </div>
        </div>
      </section>
      <section className="card" aria-labelledby="ds-o2">
        <div className="card-head"><h3 id="ds-o2">{t('design.ov.palette')}</h3></div>
        <div className="card-body stack-sm">
          <p className="small fg2" style={{ margin: 0 }}>{t('design.ov.paletteHint')} <kbd>Ctrl</kbd> <kbd>K</kbd> · <kbd>⌘</kbd> <kbd>K</kbd></p>
          <div><button type="button" className="btn" onClick={() => window.dispatchEvent(new Event('careos:palette'))}>{t('design.ov.openPalette')}</button></div>
        </div>
      </section>
      <section className="card" aria-labelledby="ds-o3">
        <div className="card-head"><h3 id="ds-o3">{t('design.ov.drawer')}</h3></div>
        <div className="card-body stack-sm">
          <p className="small fg2" style={{ margin: 0 }}>{t('design.ov.drawerHint')}</p>
          <div><Link className="btn" href="/residents">{t('nav.residents')}</Link></div>
        </div>
      </section>
      <section className="card" aria-labelledby="ds-o4">
        <div className="card-head"><h3 id="ds-o4">{t('design.ov.menu')}</h3></div>
        <div className="card-body">
          <ul className="menu ds-menu" aria-label={t('design.ov.menu')}>
            <li><button type="button">{t('design.ov.menu1')}</button></li>
            <li><button type="button">{t('design.ov.menu2')}</button></li>
            <li><button type="button" style={{ color: 'var(--crit)' }}>{t('design.ex.escalate')}</button></li>
          </ul>
        </div>
      </section>
      {open && (
        <Dialog open onClose={() => setOpen(false)} title={t('design.ov.dialogTitle')}
          context={<><strong>Keller Rosa</strong><span className="mono">{t('design.ex.room', { n: '12' })}</span></>}
          footer={<><button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button><button type="button" className="btn primary" onClick={() => { setOpen(false); toast(t('design.fields.savedDemo')) }}>{t('common.save')}</button></>}>
          <NumberField label={t('design.fields.temp')} unit="°C" min={30} max={45} step={0.1} warn={{ lo: 35.5, hi: 38 }} />
          <Textarea label={t('design.fields.note')} rows={3} optional />
        </Dialog>
      )}
      {confirmNode}
    </div>
  )
}

/** Toasts, Inline-Meldungen, Leerzustände. */
export function Feedback() {
  const t = useT()
  return (
    <div className="grid-2">
      <section className="card" aria-labelledby="ds-f1">
        <div className="card-head"><h3 id="ds-f1">{t('design.fb.toast')}</h3></div>
        <div className="card-body stack-sm">
          <div className="row">
            <button type="button" className="btn" onClick={() => toast(t('design.fb.toastDone'))}>{t('design.fb.standard')}</button>
            <button type="button" className="btn" onClick={() => toast(t('design.fb.toastDone'), { undo: () => toast(t('design.fb.undone')), undoLabel: t('common.undo') })}>{t('design.fb.withUndo')}</button>
            <button type="button" className="btn danger" onClick={() => toast(t('design.fb.toastCrit'), { kind: 'crit', ms: 6000 })}>{t('design.fb.critical')}</button>
          </div>
          <p className="okmsg" style={{ margin: 0 }}>✓ {t('design.fb.inlineOk')}</p>
          <p className="err" style={{ margin: 0 }}>{t('design.fb.inlineErr')}</p>
        </div>
      </section>
      <div className="stack-sm">
        <Empty title={t('design.fb.emptyTitle')} action={<button type="button" className="btn primary">{t('design.fb.emptyAction')}</button>}>{t('design.fb.emptyText')}</Empty>
        <NotFoundState compact backHref="#ds-feedback" backLabel={t('design.fb.back')} />
      </div>
    </div>
  )
}

/** Diagramme mit Referenzband, Zielwert und auffälligen Werten. */
export function Charts() {
  const t = useT()
  const locale = useLocale()
  const days = ['16.', '17.', '18.', '19.', '20.', '21.', '22.']
  const temps = [36.8, 37.0, 37.2, 37.6, 38.3, 38.1, 37.4]
  const drink = [1450, 1600, 1200, 980, 1350, 1500, 1100]
  return (
    <div className="charts">
      <LineChart
        title={t('design.ex.temp')} unit="°C" dec={1} lo={36} hi={37.5} current={fmtNum(37.4, 1, locale)}
        points={days.map((d, i) => ({ label: d, title: `${d} ${fmtNum(temps[i], 1, locale)} °C`, v: temps[i] }))}
        legend={{ band: t('design.ex.refBand') }} ariaLabel={t('design.ex.tempAria')} formatValue={(v) => fmtNum(v, 1, locale)}
      />
      <LineChart
        title={t('design.ex.bp')} unit="mmHg" lo={90} hi={140} lo2={60} current="132/78"
        points={days.map((d, i) => ({ label: d, title: d, v: [128, 135, 142, 138, 131, 129, 132][i], v2: [76, 80, 88, 79, 74, 72, 78][i] }))}
        legend={{ primary: t('design.ex.sys'), secondary: t('design.ex.dia'), band: t('design.ex.refBand') }} ariaLabel={t('design.ex.bpAria')}
      />
      <BarChart
        title={t('design.ex.drink')} unit="ml" target={1500} current={fmtNum(1100, 0, locale)}
        bars={days.map((d, i) => ({ label: d, title: `${d} ${drink[i]} ml`, v: drink[i], tone: drink[i] < 1000 ? 'crit' : '' }))}
        legend={{ bar: t('design.ex.drinkBar'), crit: t('design.ex.drinkLow'), target: t('design.ex.drinkTarget') }} ariaLabel={t('design.ex.drinkAria')}
      />
    </div>
  )
}

/** Skeletons und Ladezustände. */
export function Loading() {
  const t = useT()
  return (
    <div className="stack">
      <div className="row">
        <button type="button" className="btn primary" data-loading="true" aria-busy="true">{t('common.save')}</button>
        <span className="small muted">{t('design.ld.button')}</span>
      </div>
      <SkelMetrics n={4} />
      <div className="grid-2">
        <SkelList n={3} />
        <SkelTable rows={3} cols={3} />
      </div>
      <div className="card card-body stack-sm" aria-hidden="true">
        <span className="lbl"><Bar w={120} /></span>
        <Block h={84} />
      </div>
      <p className="small muted ds-note">{t('design.ld.hint')}</p>
    </div>
  )
}
