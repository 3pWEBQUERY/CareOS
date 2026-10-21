// Produktionsstart (Railway): Zeitzone setzen, optional Demodaten, dann Next.js starten.
// Migrationen laufen vorher als preDeployCommand (siehe railway.json).
import { spawn } from 'node:child_process'

process.env.TZ ||= 'Europe/Zurich'
const port = process.env.PORT || '3000'

const run = (file) => new Promise((r) => spawn('npx', ['tsx', file], { stdio: 'inherit', env: process.env }).on('exit', r))
// Beide Skripte tun nur etwas, wenn die Datenbank leer ist.
if (process.env.SEED_DEMO === 'true') await run('prisma/seed.ts')
else if (process.env.INIT_ADMIN_EMAIL) await run('prisma/bootstrap.ts')

const next = spawn('npx', ['next', 'start', '-p', port, '-H', '0.0.0.0'], { stdio: 'inherit', env: process.env })
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => next.kill(sig))
next.on('exit', (code) => process.exit(code ?? 0))
