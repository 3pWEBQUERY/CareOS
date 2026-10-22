import type { NextRequest } from 'next/server'

/**
 * Branding (Admin → Organisation) als Stylesheet statt Inline-<style>: so braucht die Akzentfarbe keine CSP-Nonce
 * und bleibt auch nach Client-Navigation (z. B. direkt nach der Anmeldung) wirksam.
 * Inhalt hängt nur von der validierten Farbe ab (#RRGGBB) und ist unbegrenzt cachebar.
 */
export function GET(req: NextRequest) {
  const c = (req.nextUrl.searchParams.get('c') ?? '').replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(c)) return new Response('/* invalid */', { status: 400, headers: { 'content-type': 'text/css; charset=utf-8' } })
  return new Response(brandCss('#' + c.toUpperCase()), {
    headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=31536000, immutable' },
  })
}

/** Akzentfarbe nur für die helle Darstellung (Kontrast ≥ 4.5:1 wird beim Speichern geprüft). */
function brandCss(c: string) {
  const vars = `--accent:${c};--accent-hover:color-mix(in srgb, ${c} 82%, #000);--accent-soft:color-mix(in srgb, ${c} 14%, #fff)`
  return `:root[data-theme="light"]{${vars}}@media (prefers-color-scheme: light){:root[data-theme="system"]{${vars}}}\n`
}
