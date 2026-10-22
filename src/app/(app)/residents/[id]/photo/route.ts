import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCtx, residentInScope } from '@/lib/context'
import { storageConfigured } from '@/lib/env'
import { signedGetUrl } from '@/lib/storage'

/**
 * Bewohnerfoto (PRD §32): nur für Personen mit Zugriff auf diese Akte (Bereich), über eine kurzlebige Bucket-URL.
 * Kein eigener Audit-Eintrag je Anzeige – das Foto erscheint in Listen und Dialogen; der Aktenzugriff selbst wird
 * protokolliert (resident.view), Aufnahme und Entfernen ebenfalls.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getCtx()
  const r = await residentInScope(ctx, id)
  if (!r?.photoFileId || r.anonymisedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!storageConfigured()) return NextResponse.json({ error: 'storage_not_configured' }, { status: 503 })
  const f = await db.fileObject.findFirst({ where: { id: r.photoFileId, orgId: ctx.org.id } })
  if (!f) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const url = await signedGetUrl(f.key, f.filename, true, 300)
  return NextResponse.redirect(url, { headers: { 'cache-control': 'private, no-store' } })
}
