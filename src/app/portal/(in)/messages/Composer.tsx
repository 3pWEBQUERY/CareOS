'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useT } from '@/i18n/client'
import { ActionForm } from '@/components/ui/ActionForm'
import { TextField, Textarea } from '@/components/ui/fields'
import { MESSAGE_MAX, SUBJECT_MAX } from '@/lib/portal/policy'
import { newMessageAction, replyMessageAction } from '../actions'

export function NewMessage({ cancelHref }: { cancelHref: string | null }) {
  const t = useT()
  const router = useRouter()
  return (
    <ActionForm action={newMessageAction} onDone={(r) => { if (r.ok && r.data) router.push(`/portal/messages/${(r.data as { id: string }).id}`) }}>
      <TextField label={t('portal.messages.subject')} name="subject" required maxLength={SUBJECT_MAX} placeholder={t('portal.messages.subjectPh')} />
      <Textarea label={t('portal.messages.body')} name="body" required rows={5} maxLength={MESSAGE_MAX} hint={t('portal.messages.hint')} />
      <div className="form-actions">
        <span className="spacer" />
        {cancelHref && <Link className="btn" href={cancelHref}>{t('common.cancel')}</Link>}
        <button type="submit" className="btn primary">{t('portal.messages.send')}</button>
      </div>
    </ActionForm>
  )
}

export function Reply({ threadId }: { threadId: string }) {
  const t = useT()
  return (
    <ActionForm action={replyMessageAction.bind(null, threadId)}>
      <Textarea label={t('portal.messages.reply')} name="body" required rows={3} maxLength={MESSAGE_MAX} />
      <div className="form-actions">
        <span className="spacer" />
        <button type="submit" className="btn primary">{t('portal.messages.send')}</button>
      </div>
    </ActionForm>
  )
}
