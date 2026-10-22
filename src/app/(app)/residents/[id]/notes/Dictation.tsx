'use client'

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { useLocale, useT } from '@/i18n/client'
import { INTL_LOCALE } from '@/i18n/core'
import { toast } from '@/components/toast'
import { Dialog } from '@/components/ui/Dialog'
import { Checkbox } from '@/components/ui/fields'
import { IconMic } from '@/components/icons'
import { ackDictationNotice, transcribeDictation } from './actions'

type SpeechRec = {
  lang: string; continuous: boolean; interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null; onerror: ((e: { error?: string }) => void) | null
  start(): void; stop(): void
}
const speechCtor = () => {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export type DictationConfig = {
  /** server = eigener Speech-to-Text-Dienst, browser = Spracherkennung des Browsers, none = kein Diktat */
  mode: 'server' | 'browser' | 'none'
  /** Datenschutzhinweis zum Browser-Diktat bereits bestätigt */
  acked: boolean
  service?: string | null
  region?: string | null
}
export type DictationHandle = { stop(): void }

const MAX_SECONDS = 120

/**
 * Diktat im Verlauf (PRD §10.4): nur mit Berechtigung «Diktat», Text landet im Eingabefeld und wird erst nach
 * Prüfung gespeichert. Browser-Spracherkennung erst nach bestätigtem Datenschutzhinweis (Audio geht an den
 * Hersteller des Browsers); mit eigenem Dienst wird kurz aufgenommen und serverseitig erkannt.
 * Browser ohne Spracherkennung (z. B. Firefox) erhalten eine Erklärung statt eines fehlenden Knopfs.
 */
export function Dictation({ residentId, config, onText, ref }: {
  residentId: string
  config: DictationConfig
  onText: (text: string) => void
  ref?: Ref<DictationHandle>
}) {
  const t = useT()
  const locale = useLocale()
  const [listening, setListening] = useState(false)
  const [busy, setBusy] = useState(false)
  const [secs, setSecs] = useState(0)
  const [acked, setAcked] = useState(config.acked)
  const [notice, setNotice] = useState(false)
  const [noticeOk, setNoticeOk] = useState(false)
  const [unsupported, setUnsupported] = useState(false)
  const rec = useRef<SpeechRec | null>(null)
  const media = useRef<MediaRecorder | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const stop = () => {
    rec.current?.stop()
    if (media.current && media.current.state !== 'inactive') media.current.stop()
  }
  useImperativeHandle(ref, () => ({ stop }))
  useEffect(() => () => { rec.current?.stop(); media.current?.stream.getTracks().forEach((x) => x.stop()); if (timer.current) clearInterval(timer.current) }, [])

  if (config.mode === 'none') return null

  const startBrowser = () => {
    const Ctor = speechCtor()
    if (!Ctor) { setUnsupported(true); return }
    const r = new Ctor()
    r.lang = INTL_LOCALE[locale]
    r.continuous = true
    r.interimResults = false
    r.onresult = (e) => {
      let add = ''
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) add += e.results[i][0].transcript
      if (add.trim()) onText(add.trim())
    }
    r.onend = () => setListening(false)
    r.onerror = (e) => { setListening(false); toast(t(e?.error === 'not-allowed' ? 'chart.dictation.errors.micDenied' : 'chart.notes.voiceError'), { kind: 'crit' }) }
    rec.current = r
    r.start()
    setListening(true)
  }

  const startServer = async () => {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) { setUnsupported(true); return }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      toast(t('chart.dictation.errors.micDenied'), { kind: 'crit' })
      return
    }
    const mr = new MediaRecorder(stream)
    const chunks: Blob[] = []
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    mr.onstop = async () => {
      stream.getTracks().forEach((x) => x.stop())
      if (timer.current) clearInterval(timer.current)
      setListening(false)
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' })
      if (!blob.size) return
      setBusy(true)
      const f = new FormData()
      f.set('audio', new File([blob], 'diktat.webm', { type: blob.type }))
      const r = await transcribeDictation(residentId, f).catch(() => ({ ok: false as const, error: 'common.genericError' }))
      setBusy(false)
      if (!r.ok) return toast(t(r.error), { kind: 'crit' })
      if (r.data?.text) onText(r.data.text)
    }
    media.current = mr
    mr.start()
    setSecs(0)
    setListening(true)
    timer.current = setInterval(() => setSecs((s) => {
      if (s + 1 >= MAX_SECONDS) mr.stop()
      return s + 1
    }), 1000)
  }

  const toggle = () => {
    if (listening) return stop()
    if (config.mode === 'server') return void startServer()
    if (!speechCtor()) return setUnsupported(true)
    if (!acked) return setNotice(true)
    startBrowser()
  }

  const confirmNotice = async () => {
    const r = await ackDictationNotice(residentId)
    if (!r.ok) return toast(t(r.error), { kind: 'crit' })
    setAcked(true)
    setNotice(false)
    startBrowser()
  }

  const label = busy ? t('chart.dictation.transcribing') : listening ? t('chart.notes.voiceStop') + (config.mode === 'server' ? ` ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '') : t('chart.notes.voice')
  return (
    <>
      <button type="button" className={'btn' + (listening ? ' is-recording' : '')} onClick={toggle} aria-pressed={listening} disabled={busy} data-loading={busy || undefined}
        title={t(config.mode === 'server' ? 'chart.dictation.hintServer' : 'chart.dictation.hintBrowser', { service: config.service ?? '' })}>
        <IconMic size={16} />{label}
      </button>
      {listening && <span className="sr-only" role="status">{t('chart.dictation.recording')}</span>}
      {notice && (
        <Dialog open onClose={() => setNotice(false)} title={t('chart.dictation.noticeTitle')}
          footer={<><button type="button" className="btn" onClick={() => setNotice(false)}>{t('common.cancel')}</button><button type="button" className="btn primary" disabled={!noticeOk} onClick={confirmNotice}>{t('chart.dictation.noticeConfirm')}</button></>}>
          <p style={{ margin: 0 }}>{t('chart.dictation.noticeText')}</p>
          <ul className="confirm-list">
            <li>{t('chart.dictation.noticeNoIds')}</li>
            <li>{t('chart.dictation.noticeReview')}</li>
            <li>{t('chart.dictation.noticeAlt')}</li>
          </ul>
          <Checkbox checked={noticeOk} onChange={(e) => setNoticeOk(e.target.checked)} label={t('chart.dictation.noticeAck')} />
        </Dialog>
      )}
      {unsupported && (
        <Dialog open onClose={() => setUnsupported(false)} title={t('chart.dictation.unsupportedTitle')}
          footer={<button type="button" className="btn" onClick={() => setUnsupported(false)}>{t('common.close')}</button>}>
          <p style={{ margin: 0 }}>{t('chart.dictation.unsupportedText')}</p>
        </Dialog>
      )}
    </>
  )
}
