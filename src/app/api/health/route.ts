import { NextResponse } from 'next/server'
import { healthReport } from '@/lib/health'

export const dynamic = 'force-dynamic'

/**
 * Health Check für Railway (PRD §38): Datenbank, Bucket, Hintergrundjobs, Echtzeit, Push.
 * 503 nur ohne Datenbank (Railway startet dann neu bzw. blockiert den Deploy); sonst 200 mit status ok | degraded.
 * Öffentlich erreichbar, daher ohne Fehlermeldungen, Kennungen oder Konfigurationswerte.
 */
export async function GET() {
  const r = await healthReport()
  const body = {
    status: r.status,
    db: r.db.state,
    dbMs: r.db.ms,
    storage: r.storage?.state ?? null,
    jobs: Object.fromEntries(r.jobs.map((j) => [j.name, j.state])),
    realtime: r.realtime?.state ?? null,
    push: r.push,
    uptimeS: r.uptimeS,
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
  }
  return NextResponse.json(body, { status: r.status === 'error' ? 503 : 200, headers: { 'cache-control': 'no-store' } })
}
