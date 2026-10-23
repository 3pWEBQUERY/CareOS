import Link from 'next/link'
import type { BoardRow } from '@/lib/md/board'

/** Bausteine der ärztlichen Übersicht (Startseite interner Ärztinnen/Ärzte und Ärzteportal). Server-Komponenten. */
type T = (key: string, vars?: Record<string, string | number>) => string

export function PatientList({ t, rows, hrefOf, title, note, id = 'ph-patients' }: { t: T; rows: BoardRow[]; hrefOf: (id: string) => string; title: string; note?: string | null; id?: string }) {
  const units = new Set(rows.map((r) => r.unit))
  return (
    <section className="card" aria-labelledby={id}>
      <div className="card-head"><h2 id={id}>{title}</h2><span className="small muted">{rows.length}</span></div>
      {note && <div className="card-body small muted" style={{ paddingBottom: 0 }}>{note}</div>}
      {rows.length ? (
        <ul className="list md-patients">
          {rows.map((r) => (
            <li key={r.id}>
              <Link className="li" href={hrefOf(r.id)}>
                <span className="room mono" aria-hidden="true">{r.room ?? '–'}</span>
                <span className="grow">
                  <span className="md-name">{r.name}{units.size > 1 && <span className="small muted"> · {r.unit}</span>}</span>
                  <span className="small muted" style={{ display: 'block' }}>
                    {r.room && <span className="sr-only">{t('residents.banner.room')} {r.room} · </span>}
                    {r.lastVisit ? t('home.physician.lastVisit', { date: r.lastVisit }) : t('home.physician.noVisit')}
                    {r.nextVisit && <> · {t('home.physician.nextVisit', { when: r.nextVisit })}</>}
                  </span>
                </span>
                <span className="row md-tags" style={{ gap: 4, justifyContent: 'flex-end' }}>
                  {r.allergy && <span className="tag crit">{t('home.mine.allergy')}</span>}
                  {r.questions > 0 && <span className="tag accent">{t('home.physician.questionsN', { n: r.questions })}</span>}
                  {r.abnormal > 0 && <span className="tag warn"><span aria-hidden="true">▲ </span>{t('home.physician.abnormal', { n: r.abnormal })}</span>}
                  {r.pending > 0 && <span className={'tag ' + (r.overdue ? 'crit' : 'warn')}>{t('home.physician.pendingN', { n: r.pending })}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <div className="card-body small muted">{t('home.physician.none')}</div>}
    </section>
  )
}

export function PendingOrders({ t, items, hrefOf }: { t: T; items: { id: string; residentId: string; resident: string; drug: string; by: string | null; source: string; state: string; due: string }[]; hrefOf: (residentId: string) => string }) {
  return (
    <section className="card" aria-labelledby="ph-confirm">
      <div className="card-head"><h2 id="ph-confirm">{t('home.physician.toConfirm')}</h2></div>
      {items.length ? (
        <ul className="list">
          {items.map((m) => (
            <li key={m.id}>
              <Link className="li" href={hrefOf(m.residentId)}>
                <span className="grow">
                  <span style={{ display: 'block' }}><strong style={{ fontWeight: 500 }}>{m.drug}</strong> · {m.resident}</span>
                  <span className="small muted">{t('meds.phone.source.' + m.source)}{m.by ? ` · ${t('home.physician.by', { by: m.by })}` : ''}</span>
                </span>
                <span className={'tag ' + (m.state === 'overdue' ? 'crit' : 'warn')}>{m.state === 'overdue' ? t('home.physician.overdue') : t('home.physician.until', { when: m.due })}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <div className="card-body small muted">{t('home.physician.toConfirmNone')}</div>}
    </section>
  )
}

export function UpcomingVisits({ t, items, hrefOf }: { t: T; items: { id: string; residentId: string; resident: string; title: string; at: string; today: boolean }[]; hrefOf: (residentId: string) => string }) {
  return (
    <section className="card" aria-labelledby="ph-visits">
      <div className="card-head"><h2 id="ph-visits">{t('home.physician.visits')}</h2></div>
      {items.length ? (
        <ul className="list">
          {items.slice(0, 12).map((a) => (
            <li key={a.id}>
              <Link className="li" href={hrefOf(a.residentId)}>
                <time className="mono small nowrap">{a.at}</time>
                <span className="grow">{a.resident}<span className="small muted"> · {a.title}</span></span>
                {a.today && <span className="tag accent">{t('common.today')}</span>}
              </Link>
            </li>
          ))}
        </ul>
      ) : <div className="card-body small muted">{t('home.physician.visitsNone')}</div>}
    </section>
  )
}
