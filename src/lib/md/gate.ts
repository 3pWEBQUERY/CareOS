import 'server-only'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { Ctx } from '@/lib/context'
import { isExternalPhysician } from '@/lib/permissions'
import { mfaSetupAllowedPath } from '@/lib/mfa-policy'

/** Für das App-Layout: externe Ärztinnen/Ärzte arbeiten im Ärzteportal; nur das Profil (Sicherheit, Sprache) bleibt erreichbar. */
export async function externalToPortal(ctx: Ctx) {
  if (!isExternalPhysician(ctx.user)) return
  const path = (await headers()).get('x-careos-path') ?? ''
  if (!mfaSetupAllowedPath(path)) redirect('/md')
}
