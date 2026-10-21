import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCtx } from '@/lib/context'
import { audit } from '@/lib/audit'
import { signedGetUrl } from '@/lib/storage'
import { storageConfigured } from '@/lib/env'

/** Auslieferung über kurzlebige Presigned URL nach Berechtigungsprüfung. Klinische Dateien werden protokolliert. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx()
  const { id } = await params
  const f = await db.fileObject.findFirst({ where: { id, orgId: ctx.org.id } })
  if (!f) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (f.clinical && !ctx.can('resident.read')) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!storageConfigured()) return NextResponse.json({ error: 'storage_not_configured' }, { status: 503 })
  if (f.clinical) await audit(ctx, { action: 'file.view', entityType: 'FileObject', entityId: f.id })
  const url = await signedGetUrl(f.key, f.filename, req.nextUrl.searchParams.get('download') !== '1')
  return NextResponse.redirect(url, { headers: { 'cache-control': 'private, no-store' } })
}
