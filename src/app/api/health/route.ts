import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { storageConfigured } from '@/lib/env'

export const dynamic = 'force-dynamic'

/** Health Check für Railway (PRD §38). */
export async function GET() {
  const started = Date.now()
  try {
    await db.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok', db: 'ok', storage: storageConfigured() ? 'configured' : 'not_configured', ms: Date.now() - started })
  } catch {
    return NextResponse.json({ status: 'error', db: 'unreachable' }, { status: 503 })
  }
}
