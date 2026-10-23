import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { openApiDocument } from '@/lib/api-spec'

/** OpenAPI 3.1 der REST API v1 und FHIR (öffentlich, enthält keine Daten). Quelle: src/lib/api-spec.ts */
export function GET() {
  return NextResponse.json(openApiDocument(env.appUrl), { headers: { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } })
}
