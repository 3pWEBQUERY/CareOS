import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_AUDIO_BYTES, registerSpeechAdapter, speechProviderFor, transcribe } from './speech'

test('Diktat: ohne Integration kein serverseitiger Dienst', async () => {
  assert.equal(speechProviderFor(null), null)
  assert.equal(speechProviderFor({ active: true, config: { provider: 'unbekannt' } }), null)
  assert.deepEqual(await transcribe(null, new Uint8Array(10), 'audio/webm', 'de'), { ok: false, reason: 'no_adapter' })
})

test('Diktat: Adapter, Grössenlimit und Fehler', async () => {
  registerSpeechAdapter('echo', () => ({ id: 'echo', name: 'Echo', region: 'Schweiz', transcribe: async (a) => ` ${a.byteLength} Bytes ` }))
  registerSpeechAdapter('down', () => ({ id: 'down', name: 'Down', transcribe: async () => { throw new Error('x') } }))
  const p = speechProviderFor({ active: true, config: { provider: 'echo' } })
  assert.deepEqual(await transcribe(p, new Uint8Array(3), 'audio/webm', 'de'), { ok: true, text: '3 Bytes' })
  assert.deepEqual(await transcribe(p, new Uint8Array(MAX_AUDIO_BYTES + 1), 'audio/webm', 'de'), { ok: false, reason: 'too_large' })
  assert.deepEqual(await transcribe(speechProviderFor({ active: true, config: { provider: 'down' } }), new Uint8Array(3), 'audio/webm', 'de'), { ok: false, reason: 'error' })
})
