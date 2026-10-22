/**
 * Erststart ohne Demodaten: legt Organisation, Standort, Wohngruppen, Standardkonfiguration und
 * eine Systemadministration an – nur wenn die Datenbank leer ist (Logik: src/lib/org-setup.ts).
 *
 * Pflicht:  INIT_ADMIN_EMAIL, INIT_ADMIN_PASSWORD (min. 12 Zeichen)
 * Optional: INIT_ORG_NAME, INIT_LOCATION_NAME, INIT_UNIT_NAME (Präfix, Standard «Wohngruppe»), INIT_UNITS (Standard 4),
 *           INIT_ADMIN_FIRST_NAME, INIT_ADMIN_LAST_NAME,
 *           INIT_STAFF (zufällige Mitarbeitende ohne Passwort, Standard 0), INIT_STAFF_DOMAIN (Standard example.ch),
 *           INIT_RESIDENTS (zufällige Bewohnende, nur Stammdaten, Standard 0), INIT_SEED (reproduzierbare Zufallsdaten)
 */
import { PrismaClient } from '@prisma/client'
import { hash } from '@node-rs/argon2'
import { setupOrganization } from '../src/lib/org-setup'

const db = new PrismaClient()
const num = (v: string | undefined, d: number) => (v && /^\d+$/.test(v.trim()) ? Number(v.trim()) : d)

async function main() {
  if (await db.organization.count()) return console.log('Bootstrap übersprungen: Datenbank enthält bereits eine Organisation.')
  const email = (process.env.INIT_ADMIN_EMAIL ?? '').trim().toLowerCase()
  const password = process.env.INIT_ADMIN_PASSWORD ?? ''
  if (!email || password.length < 12) return console.log('Bootstrap übersprungen: INIT_ADMIN_EMAIL und INIT_ADMIN_PASSWORD (min. 12 Zeichen) setzen.')

  const r = await setupOrganization(db, {
    source: 'bootstrap',
    onlyIfEmpty: true,
    orgName: process.env.INIT_ORG_NAME || 'Meine Organisation',
    locationName: process.env.INIT_LOCATION_NAME,
    unitName: process.env.INIT_UNIT_NAME,
    units: num(process.env.INIT_UNITS, 4),
    admin: {
      email,
      firstName: process.env.INIT_ADMIN_FIRST_NAME,
      lastName: process.env.INIT_ADMIN_LAST_NAME,
      passwordHash: await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
    },
    staff: num(process.env.INIT_STAFF, 0),
    staffDomain: process.env.INIT_STAFF_DOMAIN || 'example.ch',
    residents: num(process.env.INIT_RESIDENTS, 0),
    seed: process.env.INIT_SEED || null,
  })
  if (!r) return console.log('Bootstrap übersprungen: Datenbank enthält bereits eine Organisation.')
  const c = r.counts
  console.log(`Organisation "${process.env.INIT_ORG_NAME || 'Meine Organisation'}" angelegt: ${c.units} Wohngruppen, ${c.rooms} Zimmer, ${c.staff} Mitarbeitende, ${c.residents} Bewohnende. Anmeldung: ${email}`)
  if (c.staff) console.log('Einladungslinks für die Mitarbeitenden: Admin → Benutzer → Einladungen → «Links erzeugen».')
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
