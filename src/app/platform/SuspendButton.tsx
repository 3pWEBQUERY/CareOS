'use client'

import { useT } from '@/i18n/client'
import { FormDialog } from '@/components/admin/ui'
import { TextField } from '@/components/ui/fields'
import type { ActionResult } from '@/lib/action'

/** Sperren mit optionalem Grund (Dialog mit Patienten-/Organisationszuordnung im Titel). */
export function SuspendButton({ id, name, label, action }: { id: string; name: string; label: string; action: (form: FormData) => Promise<ActionResult> }) {
  const t = useT()
  return (
    <FormDialog label={label} buttonClass="btn sm danger" title={`${label} · ${name}`} action={action} submit={label} submitClass="btn danger" success="tenancy.platform.suspended">
      <input type="hidden" name="id" value={id} />
      <p className="fg2" style={{ margin: 0 }}>{t('tenancy.platform.suspendHint')}</p>
      <TextField label={t('tenancy.platform.suspendReason')} name="reason" maxLength={200} optional />
    </FormDialog>
  )
}
