import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { storageConfigured } from '@/lib/env'
import { signedGetUrl } from '@/lib/storage'
import { getPortalCtx, portalAudit } from '@/lib/portal/context'
import { hasGrant, isShareableFileCategory } from '@/lib/portal/policy'

/** Freigegebene Datei der Akte (ResidentFile.portalShared, nur nicht klinische Kategorien) für Angehörige. Protokolliert. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const p = await getPortalCtx()
  const cur = p.current
  if (!cur || !hasGrant(cur.grants, 'files')) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  const f = await db.residentFile.findFirst({ where: { id, residentId: cur.residentId, portalShared: true, file: { orgId: p.org.id } }, include: { file: true } })
  if (!f || !isShareableFileCategory(f.category)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!storageConfigured()) return NextResponse.json({ error: 'storage_not_configured' }, { status: 503 })
  await portalAudit(p, { action: 'portal.file.view', entityType: 'ResidentFile', entityId: f.id, context: { residentId: cur.residentId } })
  const url = await signedGetUrl(f.file.key, f.file.filename, req.nextUrl.searchParams.get('download') !== '1')
  return NextResponse.redirect(url, { headers: { 'cache-control': 'private, no-store' } })
}
