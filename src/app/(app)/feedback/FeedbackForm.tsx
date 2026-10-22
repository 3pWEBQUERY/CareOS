'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { ActionForm, Submit } from '@/components/ui/ActionForm'
import { Checkbox, RadioGroup, SegmentedControl, Textarea } from '@/components/ui/fields'
import { sendFeedbackAction } from './actions'

/** Rückmeldung: Art wählen; bei «Bewertung» Skala 1–5 und optionaler Kommentar. */
export function FeedbackForm({ from, fromLabel }: { from: string; fromLabel: string | null }) {
  const t = useT()
  const [kind, setKind] = useState('problem')
  return (
    <ActionForm action={sendFeedbackAction} success="platform.feedback.sent">
      <SegmentedControl name="kind" label={t('platform.feedback.kind')} value={kind} onChange={setKind} options={(['problem', 'idea', 'rating'] as const).map((k) => ({ value: k, label: t('platform.feedback.kinds.' + k) }))} />
      {kind === 'rating' && (
        <RadioGroup name="rating" label={t('platform.feedback.rating')} required options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} – ${t('platform.feedback.ratings.r' + n)}` }))} />
      )}
      <Textarea
        name="text"
        label={kind === 'rating' ? t('platform.feedback.textOptional') : t('platform.feedback.text')}
        hint={t('platform.feedback.textHint')}
        rows={5}
        maxLength={2000}
        required={kind !== 'rating'}
        optional={kind === 'rating'}
      />
      {fromLabel && (
        <>
          <input type="hidden" name="from" value={from} />
          <p className="small muted" style={{ margin: 0 }}>{t('platform.feedback.page')}: <code className="mono">{fromLabel}</code> · {t('platform.feedback.pageHint')}</p>
        </>
      )}
      <Checkbox name="anonymous" label={t('platform.feedback.anonymous')} />
      <div className="form-actions"><span className="spacer" /><Submit>{t('platform.feedback.send')}</Submit></div>
    </ActionForm>
  )
}
