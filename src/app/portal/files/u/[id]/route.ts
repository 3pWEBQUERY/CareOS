import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { storageConfigured } from '@/lib/env'
import { signedGetUrl } from '@/lib/storage'
import { getPortalCtx, portalAudit } from '@/lib/portal/context'
import { portalUpdates } from '@/lib/portal/data'

/** Anhang einer Mitteilung für Angehörige (z. B. Menüplan). Nur Dateien mit purpose «portal» einer sichtbaren Mitteilung. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const p = await getPortalCtx()
  const cur = p.current
  if (!cur) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params
  const updates = await portalUpdates(p, cur, 200)
  if (!updates.some((u) => u.fileIds.includes(id))) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const f = await db.fileObject.findFirst({ where: { id, orgId: p.org.id, purpose: 'portal', clinical: false } })
  if (!f) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!storageConfigured()) return NextResponse.json({ error: 'storage_not_configured' }, { status: 503 })
  await portalAudit(p, { action: 'portal.file.view', entityType: 'FileObject', entityId: f.id, context: { residentId: cur.residentId } })
  const url = await signedGetUrl(f.key, f.filename, req.nextUrl.searchParams.get('download') !== '1')
  return NextResponse.redirect(url, { headers: { 'cache-control': 'private, no-store' } })
}
