import { orgHasModule } from '@/lib/modules'

/**
 * Einzige Prüfstelle, ob das Angehörigenportal für eine Organisation aktiv ist (Modul «portals», src/lib/modules.ts).
 * Portal-Kontext, Team-Seite, Einladungen und Benachrichtigungen fragen nur hier.
 */
export function portalEnabled(org: { modules?: readonly string[] | null } | null | undefined) {
  return !!org && orgHasModule(org, 'portals')
}
