'use client'

import { useT } from '@/i18n/client'
import { NotFoundState } from '@/components/ui/ErrorState'

/** Eintrag oder Register der Akte nicht gefunden (bzw. ausserhalb des Zugriffsbereichs). */
export default function RecordNotFound() {
  const t = useT()
  return <NotFoundState compact backHref="/residents" backLabel={t('common.notFoundPage.backResidents')} />
}
