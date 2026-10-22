'use client'

import { useState, useTransition } from 'react'
import { useT } from '@/i18n/client'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { ConfirmDialog, splitQuestion } from '@/components/ui/ConfirmDialog'
import { issueInvitesAction, type InviteLinkRow } from './actions'

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast(done)
  } catch {
    /* Zwischenablage nicht verfügbar – Link bleibt markierbar */
  }
}

export function CopyBtn({ value, label, className = 'btn sm' }: { value: string; label?: string; className?: string }) {
  const t = useT()
  return <button type="button" className={className} onClick={() => copy(value, t('register.admin.copied'))}>{label ?? t('admin.common.copy')}</button>
}

/**
 * Einladungslinks für Konten ohne Zugang erzeugen (einzeln oder alle) und einmalig anzeigen.
 * Bestätigung nur, wenn dabei noch gültige Links ersetzt werden.
 */
export function InviteLinks({ ids, label, className = 'btn', replaces, days }: { ids: string[]; label: string; className?: string; replaces: boolean; days: number }) {
  const t = useT()
  const [asking, setAsking] = useState(false)
  const [links, setLinks] = useState<InviteLinkRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const tr = (s: string) => (/^[a-z]+\.[\w.]+$/.test(s) ? t(s) : s)
  const exec = () =>
    start(async () => {
      const r = await issueInvitesAction(ids)
      if (r.ok && r.data) {
        setAsking(false)
        setLinks(r.data.links)
      } else if (!r.ok) {
        if (asking) setError(tr(r.error))
        else toast(tr(r.error), { kind: 'crit' })
      }
    })
  const q = splitQuestion(t('register.admin.generateConfirm', { n: ids.length }))
  const all = links?.map((l) => `${l.name}\t${l.email}\t${l.link}`).join('\n') ?? ''
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={pending || !ids.length}
        data-loading={(pending && !asking) || undefined}
        onClick={() => {
          setError(null)
          if (replaces) setAsking(true)
          else exec()
        }}
      >
        {label}
      </button>
      <ConfirmDialog open={asking} onClose={() => setAsking(false)} onConfirm={exec} title={q.title} text={q.text} confirmLabel={label} pending={pending} error={error} />
      <Dialog
        open={!!links}
        onClose={() => setLinks(null)}
        title={t('register.admin.linksTitle')}
        wide
        footer={
          <>
            {links && links.length > 1 && <CopyBtn value={all} label={t('register.admin.copyAll')} className="btn" />}
            <button type="button" className="btn primary" onClick={() => setLinks(null)}>{t('common.close')}</button>
          </>
        }
      >
        <p className="alert warn" style={{ margin: 0 }}>{t('register.admin.linksIntro', { days })}</p>
        <ul className="list inv-links">
          {links?.map((l) => (
            <li key={l.id}>
              <div className="li inv-row">
                <div className="grow" style={{ minWidth: 0 }}>
                  <strong>{l.name}</strong> <span className="small muted">{l.email}</span>
                  <code className="mono inv-link">{l.link}</code>
                </div>
                <CopyBtn value={l.link} />
              </div>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  )
}
