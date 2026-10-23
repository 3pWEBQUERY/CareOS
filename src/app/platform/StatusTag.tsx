/** Status einer Organisation mit Text (nie nur Farbe). */
export function StatusTag({ status, t }: { status: 'active' | 'pending' | 'suspended'; t: (k: string) => string }) {
  return <span className={'tag ' + (status === 'active' ? 'ok' : status === 'pending' ? 'warn' : 'crit')}>{t('tenancy.platform.status.' + status)}</span>
}
