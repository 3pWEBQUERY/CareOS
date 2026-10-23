'use client'

import { useEffect, useState } from 'react'
import { I18nProvider, useT } from '@/i18n/client'
import { LOCALES, pickLocale, type Locale, type Tree } from '@/i18n/core'
import { Brand } from '@/components/Brand'
import { toast, Toaster } from '@/components/toast'
import { offlineSupported, queueOp, useOutbox } from '@/lib/offline/client'
import { loadSnapshot, loadTour } from '@/lib/offline/store'
import { NOTE_CATEGORIES, type ShiftSnapshot, type TourSnapshot } from '@/lib/offline/types'
import { Select, Textarea } from '@/components/ui/fields'
import { TourCard } from '@/components/spitex/TourCard'

type State = { status: 'loading' } | { status: 'none' } | { status: 'ok'; snap: ShiftSnapshot | null; tour: TourSnapshot | null }

export function OfflineView({ messages }: { messages: Record<Locale, Tree> }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  // Sprache erst nach dem Laden bestimmen (Server kennt weder Lesestand noch Browsersprache)
  const [browserLocale, setBrowserLocale] = useState<Locale>('de')
  useEffect(() => {
    setBrowserLocale(pickLocale(navigator.language))
    if (!offlineSupported()) { setState({ status: 'none' }); return }
    // Spitex: «Meine Tour» liegt als eigener Lesestand vor (auch ohne Schicht-Lesestand nutzbar)
    void Promise.all([loadSnapshot(), loadTour().catch(() => null)]).then(([snap, tour]) => {
      const mine = tour && (!snap || tour.userId === snap.userId) ? tour : null
      setState(snap || mine ? { status: 'ok', snap, tour: mine } : { status: 'none' })
      if (snap?.theme && ['light', 'dark', 'system'].includes(snap.theme)) document.documentElement.dataset.theme = snap.theme
      if (snap?.locale) document.documentElement.lang = snap.locale
    }).catch(() => setState({ status: 'none' }))
  }, [])
  const locale: Locale = state.status === 'ok' && state.snap && (LOCALES as readonly string[]).includes(state.snap.locale)
    ? (state.snap.locale as Locale)
    : browserLocale
  return (
    <I18nProvider locale={locale} terminology="resident" messages={messages[locale]}>
      <View state={state} />
      <Toaster />
    </I18nProvider>
  )
}

function View({ state }: { state: State }) {
  const t = useT()
  const [online, setOnline] = useState(true)
  const snap = state.status === 'ok' ? state.snap : null
  const tour = state.status === 'ok' ? state.tour : null
  const counts = useOutbox(snap?.userId ?? tour?.userId)
  useEffect(() => {
    const upd = () => setOnline(navigator.onLine)
    upd()
    window.addEventListener('online', upd)
    window.addEventListener('offline', upd)
    return () => { window.removeEventListener('online', upd); window.removeEventListener('offline', upd) }
  }, [])
  const saved = snap?.savedAt ?? tour?.savedAt
  const time = saved ? new Date(saved).toLocaleTimeString(!snap || snap.locale === 'en' ? 'en-GB' : snap.locale + '-CH', { hour: '2-digit', minute: '2-digit' }) : ''

  return (
    <main className="panel main offline-view" style={{ overflow: 'visible' }}>
      <div className="view-head">
        <div style={{ minWidth: 0 }}>
          <Brand />
          <h1 style={{ marginTop: 6 }}>{t('common.offlineSync.page.title')}</h1>
          {snap && <p className="sub">{[snap.unit, snap.userName].filter(Boolean).join(' · ')}</p>}
        </div>
        <a className={'btn' + (online ? ' primary' : '')} href="/">{online ? t('common.offlineSync.page.openApp') : t('common.offlineSync.page.retry')}</a>
      </div>
      <div className="tabpanel">
        {(snap || tour) && (
          <div className={'alert ' + (online ? 'info' : 'warn')} role="status">
            <div className="grow">
              <strong>{t(online ? 'common.offlineSync.page.standOnline' : 'common.offlineSync.page.stand', { time })}</strong>
              {t('common.offlineSync.page.readOnly')}
              {counts.queued > 0 && <> · {t('common.offlineQueued', { n: counts.queued })}</>}
            </div>
          </div>
        )}
        {state.status === 'none' && (
          <div className="empty">
            <strong>{t('common.offlineSync.page.none')}</strong>
            <span>{t('common.offlineSync.page.noneHint')}</span>
          </div>
        )}
        {tour && <Tour tour={tour} />}
        {snap && <Residents snap={snap} />}
      </div>
    </main>
  )
}

/** Spitex: Tour des Tages offline – Beginn und Abschluss werden mit dem Zeitpunkt des Geräts vorgemerkt. */
function Tour({ tour }: { tour: TourSnapshot }) {
  const t = useT()
  const current = tour.visits.find((v) => v.status === 'planned' || v.status === 'started')?.id
  return (
    <section className="stack-sm" aria-labelledby="off-tour">
      <h2 className="sec" id="off-tour">{t('spitex.tour.title')}</h2>
      <ol className="sx-tour">
        {tour.visits.map((v, i) => (
          <TourCard key={v.id} v={v} n={i + 1} current={v.id === current}
            onStep={async (d) => {
              try {
                await queueOp({ kind: 'visit', residentId: v.residentId, data: d }, { who: v.name, label: `${v.from}–${v.to}` }, tour.userId)
                return { ok: true, queued: true, message: 'common.offlineSync.queued' }
              } catch {
                return { ok: false, error: 'common.offlineSync.unsupported' }
              }
            }} />
        ))}
      </ol>
    </section>
  )
}

function Residents({ snap }: { snap: ShiftSnapshot }) {
  const t = useT()
  const loose = snap.tasks.filter((k) => !k.residentId)
  return (
    <>
      <ul className="list" style={{ border: '1px solid var(--line)', borderRadius: 'var(--r)' }}>
        {snap.residents.map((r) => <ResidentRow key={r.id} r={r} tasks={snap.tasks.filter((k) => k.residentId === r.id)} userId={snap.userId} />)}
      </ul>
      {loose.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>{t('common.offlineSync.page.tasks')}</h2></div>
          <ul className="list">{loose.map((k) => <li key={k.id}><div className="li"><span className="mono">{k.time}</span><span className="grow">{k.title}</span></div></li>)}</ul>
        </section>
      )}
    </>
  )
}

function ResidentRow({ r, tasks, userId }: { r: ShiftSnapshot['residents'][number]; tasks: ShiftSnapshot['tasks']; userId: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<string>('care')
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (text.trim().length < 3) { setErr(t('common.offlineSync.reason.invalid')); return }
    setBusy(true)
    try {
      await queueOp({ kind: 'note', residentId: r.id, data: { category, text: text.trim(), important: false } }, { who: r.name }, userId)
      setText(''); setOpen(false); setErr(null)
      toast(t('common.offlineSync.queued'))
    } catch {
      setErr(t('common.offlineSync.unsupported'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <li>
      <div className="li" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 500 }}>
              {r.room && <span className="mono muted" style={{ marginRight: 8 }}>{t('common.offlineSync.page.room', { room: r.room })}</span>}
              {r.name}
            </div>
            <div className="row" style={{ gap: 6, marginTop: 4 }}>
              <span className={'flag ' + (r.rea === 'no' ? 'rea-no' : r.rea === 'yes' ? 'rea-yes' : '')}>{t('common.offlineSync.page.rea.' + r.rea)}</span>
              {r.allergies.length
                ? <span className="flag crit">{t('common.offlineSync.page.allergies')}: {r.allergies.join(', ')}</span>
                : <span className="small muted">{t('common.offlineSync.page.noAllergies')}</span>}
              {r.risks.map((x) => <span key={x} className="flag warn">{x}</span>)}
            </div>
          </div>
          <button type="button" className="btn sm" style={{ minHeight: 40 }} aria-expanded={open} onClick={() => setOpen((v) => !v)}>{t('common.offlineSync.page.document')}</button>
        </div>
        {tasks.length > 0 && (
          <div className="stack-sm" style={{ gap: 2 }}>
            <span className="lbl">{t('common.offlineSync.page.tasks')}</span>
            {tasks.map((k) => <div key={k.id} className="small"><span className="mono" style={{ marginRight: 8 }}>{k.time}</span>{k.title}</div>)}
          </div>
        )}
        {open && (
          <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); void save() }}>
            <Select label={t('common.offlineSync.page.category')} value={category} onChange={(e) => setCategory(e.target.value)}>
                {NOTE_CATEGORIES.map((c) => <option key={c} value={c}>{t('chart.cat.' + c)}</option>)}
              </Select>
            <Textarea label={t('common.offlineSync.page.text')} rows={4} value={text} onChange={(e) => { setText(e.target.value); setErr(null) }} maxLength={8000} />
            {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
              <button type="submit" className="btn primary" disabled={busy} data-loading={busy || undefined}>{t('common.offlineSync.page.save')}</button>
            </div>
          </form>
        )}
      </div>
    </li>
  )
}
