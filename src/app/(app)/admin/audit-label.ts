import type { TFn } from '@/i18n/core'

/** Sicherheits- und datenschutzrelevante Audit-Aktionen mit lesbarer Bezeichnung (admin.ux.act.*). Andere zeigen den Schlüssel. */
export const LABELLED_ACTIONS = [
  'auth.login', 'auth.logout', 'auth.login_failed', 'auth.mfa_passed', 'auth.mfa_failed', 'auth.passkey_added', 'api.auth_failed',
  'admin.user.create', 'admin.user.invite', 'admin.user.update', 'admin.user.deactivate', 'admin.user.reactivate', 'admin.user.password_reset',
  'admin.user.mfa_reset', 'admin.user.sessions_revoked', 'admin.user.role_assign', 'admin.user.role_remove',
  'admin.role.create', 'admin.role.update', 'admin.role.delete',
  'admin.api_token.create', 'admin.api_token.revoke', 'admin.webhook.create', 'admin.webhook.delete', 'admin.webhook.rotate_secret',
  'admin.org.update', 'admin.org.branding', 'admin.privacy.retention', 'retention.run', 'admin.audit.export', 'admin.export.org', 'resident.view',
  'import.residents', 'import.staff', 'import.shifts',
  'task.template.create', 'task.template.update', 'task.template.end', 'task.template.resume', 'workflow.task', 'incident.action.assign',
  'auth.login_blocked', 'admin.user.activate', 'admin.config.modules',
  'admin.physician.create', 'admin.physician.assign', 'admin.physician.unassign', 'admin.physician.assign.import', 'md.patients.view', 'md.resident.view',
  'portal.login', 'portal.logout', 'portal.login_failed', 'portal.login_blocked', 'portal.mfa_passed', 'portal.mfa_failed', 'portal.view',
  'portal.file.view', 'portal.file.share', 'portal.file.unshare',
  'portal.access.invite', 'portal.access.reinvite', 'portal.access.accepted', 'portal.access.revoke', 'portal.access.grants', 'portal.access.consent',
  'portal.account.lock', 'portal.account.unlock', 'portal.account.update', 'portal.account.password', 'portal.account.mfa_enabled', 'portal.account.mfa_disabled', 'portal.account.sessions_revoked',
  'portal.message.create', 'portal.message.reply', 'portal.message.answer', 'portal.message.assign', 'portal.message.close', 'portal.message.reopen', 'portal.message.view',
  'portal.visit.request', 'portal.visit.cancel', 'portal.visit.confirm', 'portal.visit.decline', 'portal.visit.assign', 'portal.visit.view',
  'portal.update.create', 'portal.update.delete', 'portal.settings',
  'therapy.plan.create', 'therapy.plan.review', 'therapy.session.document',
  'adt.admit', 'adt.transfer', 'adt.leave', 'adt.return', 'adt.discharge', 'api.hl7.adt', 'api.fhir.allergy.create', 'billing.export',
  'medication.order.confirm', 'medication.order.confirm.escalate',
  'medication.stock.order', 'medication.stock.order.cancel', 'medication.stock.order.export', 'medication.stock.receipt', 'medication.stock.correct',
  'emergency.start', 'emergency.end', 'emergency.expired', 'emergency.view',
  'platform.operator_assigned', 'platform.org.create', 'platform.org.approve', 'platform.org.suspend', 'platform.org.unsuspend', 'platform.org.modules',
  'task.expire', 'absence.request', 'absence.sick', 'absence.approved', 'absence.rejected', 'absence.withdraw',
] as const

const SET = new Set<string>(LABELLED_ACTIONS)

/** Lesbare Bezeichnung einer Audit-Aktion oder `null`, wenn keine hinterlegt ist. */
export function auditLabel(t: TFn, action: string): string | null {
  if (SET.has(action)) return t('admin.ux.act.' + action.replace(/\./g, '_'))
  if (action.startsWith('admin.config.')) return t('admin.ux.act.admin_config')
  return null
}
