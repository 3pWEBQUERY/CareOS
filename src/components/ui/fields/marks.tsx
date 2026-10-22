'use client'

/** Kleine übersetzte Teile der Feld-Komponenten – als Client-Blätter auch in Server-Seiten nutzbar. */
import { useT } from '@/i18n/client'

export function OptionalMark() {
  const t = useT()
  return <span className="fld-opt"> · {t('common.optional')}</span>
}
