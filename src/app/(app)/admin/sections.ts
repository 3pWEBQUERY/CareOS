import type { Permission } from '@/lib/permissions'

/** Bereiche von CareOS Admin (PRD §45) mit der jeweils erforderlichen Berechtigung. */
export const ADMIN_SECTIONS: { key: string; href: string; perm: Permission }[] = [
  { key: 'org', href: '/admin/org', perm: 'admin.org' },
  { key: 'structure', href: '/admin/structure', perm: 'admin.org' },
  { key: 'users', href: '/admin/users', perm: 'admin.users' },
  { key: 'roles', href: '/admin/roles', perm: 'admin.roles' },
  { key: 'config', href: '/admin/config', perm: 'admin.config' },
  { key: 'forms', href: '/admin/forms', perm: 'admin.config' },
  { key: 'channels', href: '/admin/channels', perm: 'admin.config' },
  { key: 'audit', href: '/admin/audit', perm: 'admin.audit' },
  { key: 'integrations', href: '/admin/integrations', perm: 'admin.integrations' },
  { key: 'privacy', href: '/admin/privacy', perm: 'admin.org' },
]
