import type { TFn } from '@/i18n/core'

/** Sicherheitsrelevante Audit-Aktionen mit lesbarer Bezeichnung (admin.ux.act.*). Andere zeigen den Schlüssel. */
export const LABELLED_ACTIONS = [
  'auth.login', 'auth.logout', 'auth.login_failed', 'auth.mfa_passed', 'auth.mfa_failed', 'auth.passkey_added', 'api.auth_failed',
  'admin.user.create', 'admin.user.invite', 'admin.user.update', 'admin.user.deactivate', 'admin.user.reactivate', 'admin.user.password_reset',
  'admin.user.mfa_reset', 'admin.user.sessions_revoked', 'admin.user.role_assign', 'admin.user.role_remove',
  'admin.role.create', 'admin.role.update', 'admin.role.delete',
  'admin.api_token.create', 'admin.api_token.revoke', 'admin.webhook.create', 'admin.webhook.delete', 'admin.webhook.rotate_secret',
  'admin.org.update', 'admin.org.branding', 'admin.privacy.retention', 'retention.run', 'admin.audit.export', 'admin.export.org', 'resident.view',
  'import.residents', 'import.staff', 'import.shifts',
] as const

const SET = new Set<string>(LABELLED_ACTIONS)

/** Lesbare Bezeichnung einer Audit-Aktion oder `null`, wenn keine hinterlegt ist. */
export function auditLabel(t: TFn, action: string): string | null {
  if (SET.has(action)) return t('admin.ux.act.' + action.replace(/\./g, '_'))
  if (action.startsWith('admin.config.')) return t('admin.ux.act.admin_config')
  return null
}
