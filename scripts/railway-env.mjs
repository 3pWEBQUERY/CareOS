#!/usr/bin/env node
// Erzeugt den Variablenblock für den CareOS-Service auf Railway (Raw Editor → einfügen).
// Neue Geheimnisse (APP_SECRET, VAPID-Schlüssel) werden bei jedem Aufruf frisch erzeugt.
// Aufruf: node scripts/railway-env.mjs [--demo] [--admin=mail@example.ch] [--org="Alterszentrum Muster"] [--bucket=Bucket]
//        [--first=Martina --last=Keller] [--units=4] [--staff=15] [--residents=100]
import { randomBytes } from 'node:crypto'
import webpush from 'web-push'

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=')
  return [k, v.length ? v.join('=') : true]
}))
const val = (k, d) => (args[k] && args[k] !== true ? String(args[k]) : d)
const vapid = webpush.generateVAPIDKeys()
const B = args.bucket && args.bucket !== true ? args.bucket : 'Bucket'
const lines = [
  '# Datenbank (Railway Postgres)',
  'DATABASE_URL=${{Postgres.DATABASE_URL}}',
  '',
  `# Railway Bucket – Dienstname «${B}» (mit --bucket=<Name> anpassen)`,
  `BUCKET=\${{${B}.BUCKET}}`,
  `ENDPOINT=\${{${B}.ENDPOINT}}`,
  `REGION=\${{${B}.REGION}}`,
  `ACCESS_KEY_ID=\${{${B}.ACCESS_KEY_ID}}`,
  `SECRET_ACCESS_KEY=\${{${B}.SECRET_ACCESS_KEY}}`,
  '# Tab «Credentials» des Buckets: «virtual-hosted» → false (neue Railway Buckets), «path-style» → true',
  'S3_FORCE_PATH_STYLE=false',
  '',
  '# Anwendung',
  'APP_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}',
  'TZ=Europe/Zurich',
  'SESSION_HOURS=12',
  `APP_SECRET=${randomBytes(32).toString('hex')}`,
  '',
  '# Web Push',
  `VAPID_PUBLIC_KEY=${vapid.publicKey}`,
  `VAPID_PRIVATE_KEY=${vapid.privateKey}`,
  `VAPID_SUBJECT=mailto:${args.admin && args.admin !== true ? args.admin : 'it@example.ch'}`,
  '',
]
if (args.demo) {
  lines.push('# Demodaten "Haus Lindenhof" beim ersten Start (nur Test/Pilot)', 'SEED_DEMO=true', '')
} else {
  lines.push(
    '# Erststart auf leerer Datenbank: Organisation und Systemadministration anlegen (danach INIT_ADMIN_PASSWORD entfernen)',
    `INIT_ORG_NAME=${args.org && args.org !== true ? args.org : 'Meine Organisation'}`,
    `INIT_ADMIN_EMAIL=${args.admin && args.admin !== true ? args.admin : 'admin@example.ch'}`,
    `INIT_ADMIN_PASSWORD=${randomBytes(12).toString('base64url')}`,
    `INIT_ADMIN_FIRST_NAME=${val('first', 'System')}`,
    `INIT_ADMIN_LAST_NAME=${val('last', 'Administration')}`,
    '# Struktur: Anzahl Wohngruppen (Wohngruppe 1, 2 …) am Standort',
    `INIT_UNITS=${val('units', '4')}`,
    '# INIT_LOCATION_NAME=Hauptstandort',
    '# Optional: zufällig erzeugte Mitarbeitende (ohne Passwort; Einladungslinks unter Admin → Benutzer → Einladungen)',
    '# und Bewohnende (nur Stammdaten, Akte leer). Adressen unter INIT_STAFF_DOMAIN sind Platzhalter – vor dem Versand ändern.',
    `INIT_STAFF=${val('staff', '0')}`,
    'INIT_STAFF_DOMAIN=example.ch',
    `INIT_RESIDENTS=${val('residents', '0')}`,
    '# INIT_SEED=beliebiger-text   (reproduzierbare Zufallsdaten)',
    '# Optional: neue Organisationen über /register anlegen (Mehrmandanten-Instanz)',
    '# ORG_SIGNUP=false',
    '',
  )
}
lines.push(
  '# Betrieb (PRD §38, §66): Metrik-Endpunkt /api/metrics (Bearer-Token); leer = abgeschaltet',
  `METRICS_TOKEN=${randomBytes(24).toString('base64url')}`,
  '# Optional: Serverfehler zusätzlich als JSON an einen Webhook (Slack, Teams, Incident-Tool)',
  '# ERROR_WEBHOOK_URL=',
  '# Optional: LOG_LEVEL=info (debug | info | warn | error)',
  '# Optional: Content-Security-Policy nur melden statt blockieren (Einführung) bzw. zusätzliche Quellen',
  '# CSP_REPORT_ONLY=false',
  '# CSP_IMG_SRC=',
  '# CSP_CONNECT_SRC=',
  '# Bucket: Railway verschlüsselt immer und unterstützt keinen SSE-Header; S3_SSE=AES256 nur für andere S3-Anbieter',
  '# S3_SSE=',
  '',
)
lines.push('# Optional: CareOS AI', '# ANTHROPIC_API_KEY=', '# AI_MODEL=claude-opus-5-5', '', '# Optional: Single Sign-on (OpenID Connect)', '# OIDC_ISSUER=', '# OIDC_CLIENT_ID=', '# OIDC_CLIENT_SECRET=', '# OIDC_LABEL=Mit Microsoft anmelden')
console.log(lines.join('\n'))
