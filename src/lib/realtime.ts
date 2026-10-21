import 'server-only'
import { Client } from 'pg'
import type { RealtimeEvent } from '@/lib/events'

type Listener = (e: RealtimeEvent) => void

const g = globalThis as unknown as { __careosRealtime?: { listeners: Set<Listener>; client: Client | null; starting: Promise<void> | null } }
const state = (g.__careosRealtime ??= { listeners: new Set(), client: null, starting: null })

async function start() {
  if (state.client || state.starting) return state.starting ?? undefined
  state.starting = (async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL })
    client.on('notification', (n) => {
      if (n.channel !== 'careos_events' || !n.payload) return
      try {
        const e = JSON.parse(n.payload) as RealtimeEvent
        for (const l of state.listeners) l(e)
      } catch {
        /* ignorieren */
      }
    })
    client.on('error', () => {
      state.client = null
      setTimeout(() => void start(), 2000)
    })
    await client.connect()
    await client.query('LISTEN careos_events')
    state.client = client
  })().finally(() => {
    state.starting = null
  })
  return state.starting
}

/** Abonniert Domain Events dieser Instanz. Rückgabe: Funktion zum Abmelden. */
export async function subscribe(l: Listener) {
  await start()
  state.listeners.add(l)
  return () => state.listeners.delete(l)
}
