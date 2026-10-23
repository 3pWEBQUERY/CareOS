// Produktionsstart (Railway): Zeitzone setzen, Migrationen anwenden, optional Erstbefüllung, dann Next.js starten.
// Migrationen laufen hier und zusätzlich als preDeployCommand (railway.json) – `prisma migrate deploy` ist idempotent
// und hält einen Advisory Lock, mehrere Instanzen stören sich nicht. Schlägt die Migration fehl, startet die App nicht.
import { spawn } from 'node:child_process'

process.env.TZ ||= 'Europe/Zurich'
const port = process.env.PORT || '3000'

const exec = (cmd, args) => new Promise((resolve) => {
  const p = spawn(cmd, args, { stdio: 'inherit', env: process.env })
  p.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  p.on('error', (e) => { console.error(e); resolve(1) })
})

if (process.env.SKIP_MIGRATE !== 'true') {
  const code = await exec('npx', ['prisma', 'migrate', 'deploy'])
  if (code !== 0) {
    console.error(`prisma migrate deploy fehlgeschlagen (Exit-Code ${code}) – Start abgebrochen.`)
    process.exit(code || 1)
  }
}

// Beide Skripte tun nur etwas, wenn die Datenbank leer ist.
const init = process.env.SEED_DEMO === 'true' ? 'prisma/seed.ts' : process.env.INIT_ADMIN_EMAIL ? 'prisma/bootstrap.ts' : null
if (init) {
  const code = await exec('npx', ['tsx', init])
  if (code !== 0) {
    console.error(`${init} fehlgeschlagen (Exit-Code ${code}) – Start abgebrochen. Die Erstbefüllung läuft in einer Transaktion und wird beim nächsten Start wiederholt.`)
    process.exit(code || 1)
  }
}

// Optional: Mitarbeitende einer bestehenden Organisation auf ENSURE_STAFF auffüllen (Fehler stoppen den Start nicht)
if (process.env.ENSURE_STAFF) {
  const code = await exec('npx', ['tsx', 'prisma/ensure-staff.ts'])
  if (code !== 0) console.error(`prisma/ensure-staff.ts fehlgeschlagen (Exit-Code ${code}) – App startet trotzdem.`)
}

const next = spawn('npx', ['next', 'start', '-p', port, '-H', '0.0.0.0'], { stdio: 'inherit', env: process.env })
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => next.kill(sig))
next.on('exit', (code) => process.exit(code ?? 0))
