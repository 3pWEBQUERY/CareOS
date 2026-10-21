// Produktionsstart (Railway): Zeitzone setzen, optional Demodaten, dann Next.js starten.
// Migrationen laufen vorher als preDeployCommand (siehe railway.json).
import { spawn } from 'node:child_process'

process.env.TZ ||= 'Europe/Zurich'
const port = process.env.PORT || '3000'

if (process.env.SEED_DEMO === 'true') {
  const seed = spawn('npx', ['tsx', 'prisma/seed.ts'], { stdio: 'inherit', env: process.env })
  await new Promise((r) => seed.on('exit', r))
}

const next = spawn('npx', ['next', 'start', '-p', port, '-H', '0.0.0.0'], { stdio: 'inherit', env: process.env })
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => next.kill(sig))
next.on('exit', (code) => process.exit(code ?? 0))
