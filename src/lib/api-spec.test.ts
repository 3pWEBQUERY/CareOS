import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { API_OPERATIONS, openApiDocument, routeToPath } from './api-spec'
import { API_SCOPES } from './admin-shared'

const API = join(process.cwd(), 'src/app/api')

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? routes(p) : n === 'route.ts' ? [p] : []
  })
}

/** Exportierte HTTP-Methoden eines Route Handlers (export async function GET / export function POST / export const PATCH). */
function methods(file: string) {
  const src = readFileSync(file, 'utf8')
  return [...src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1].toLowerCase())
}

test('OpenAPI: jede Route unter /api/v1 und /api/fhir ist beschrieben – und umgekehrt', () => {
  const actual = new Set<string>()
  for (const base of ['v1', 'fhir']) for (const f of routes(join(API, base))) for (const m of methods(f)) actual.add(`${m} ${routeToPath(relative(API, f))}`)
  const documented = new Set(API_OPERATIONS.map((o) => `${o.method} ${o.path}`))
  const missing = [...actual].filter((x) => !documented.has(x))
  const stale = [...documented].filter((x) => !actual.has(x))
  assert.deepEqual(missing, [], 'Routen ohne Spezifikation (src/lib/api-spec.ts ergänzen)')
  assert.deepEqual(stale, [], 'Spezifikation ohne Route')
})

test('OpenAPI: Scopes stimmen mit den Route Handlern überein', () => {
  for (const base of ['v1', 'fhir']) {
    for (const f of routes(join(API, base))) {
      const src = readFileSync(f, 'utf8')
      const path = routeToPath(relative(API, f))
      const used = new Set([...src.matchAll(/apiAuth\(req,\s*'([a-z:]+)'/g)].map((m) => m[1]))
      const spec = new Set(API_OPERATIONS.filter((o) => o.path === path && o.scope).map((o) => o.scope as string))
      assert.deepEqual([...used].sort(), [...spec].sort(), `Scopes von ${path}`)
    }
  }
  for (const o of API_OPERATIONS) if (o.scope) assert.ok((API_SCOPES as readonly string[]).includes(o.scope), o.scope)
})

test('OpenAPI: gültiges Grundgerüst, eindeutige operationIds, Referenzen vorhanden', () => {
  const doc = openApiDocument('https://care.example.ch') as { openapi: string; paths: Record<string, Record<string, { operationId: string }>>; components: { schemas: Record<string, unknown> } }
  assert.equal(doc.openapi, '3.1.0')
  const ids = Object.values(doc.paths).flatMap((p) => Object.values(p).map((o) => o.operationId))
  assert.equal(new Set(ids).size, ids.length)
  const refs = [...JSON.stringify(doc).matchAll(/"#\/components\/schemas\/(\w+)"/g)].map((m) => m[1])
  for (const r of refs) assert.ok(r in doc.components.schemas, `Schema ${r}`)
})

test('Developer-Portal: jede Operation und Gruppe hat Texte in allen Sprachen', async () => {
  const { operationId } = await import('./api-spec')
  const m = (await import('../i18n/messages/developer')).default as Record<string, { ops: Record<string, string>; tags: Record<string, string> }>
  for (const loc of ['de', 'fr', 'it', 'en']) {
    for (const o of API_OPERATIONS) {
      assert.ok(m[loc].ops[operationId(o)], `${loc}: developer.ops.${operationId(o)}`)
      assert.ok(m[loc].tags[o.tag], `${loc}: developer.tags.${o.tag}`)
    }
  }
})
