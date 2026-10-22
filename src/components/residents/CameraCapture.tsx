'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '@/i18n/client'

type State = 'starting' | 'live' | 'shot' | 'unsupported' | 'denied' | 'notfound' | 'error'

/**
 * Kontrollierte Kamera im Browser (PRD §15, §32): Aufnahme über getUserMedia direkt in die App – das Bild entsteht
 * im Arbeitsspeicher und wird nie in der Galerie des Geräts abgelegt (anders als `<input capture>`, wo die
 * Kamera-App je nach Hersteller eine Kopie speichert). Startet beim Einblenden, stoppt beim Schliessen.
 * `square`: Bildausschnitt quadratisch (Bewohnerfoto); sonst Seitenverhältnis der Kamera (Wundfoto).
 */
export function CameraCapture({ onCapture, square = false, maxSize = 1600, facing = 'environment', label }: {
  onCapture: (file: File | null) => void
  square?: boolean
  maxSize?: number
  facing?: 'user' | 'environment'
  /** Beschriftung des Auslösers (Standard «Aufnehmen») */
  label?: string
}) {
  const t = useT()
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const [state, setState] = useState<State>('starting')
  const [preview, setPreview] = useState<string | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceIdx, setDeviceIdx] = useState<number | null>(null)

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((tr) => tr.stop())
    stream.current = null
  }, [])

  const start = useCallback(async (idx: number | null) => {
    stop()
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) { setState('unsupported'); return }
    setState('starting')
    try {
      const list = devices.length ? devices : []
      const deviceId = idx != null ? list[idx]?.deviceId : undefined
      const s = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      stream.current = s
      if (video.current) {
        video.current.srcObject = s
        await video.current.play().catch(() => {})
      }
      setState('live')
      if (!list.length) {
        const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
        if (all.length > 1) setDevices(all)
      }
    } catch (e) {
      const n = (e as { name?: string }).name
      setState(n === 'NotAllowedError' || n === 'SecurityError' ? 'denied' : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'notfound' : 'error')
    }
  }, [devices, facing, stop])

  useEffect(() => {
    void start(null)
    return () => stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const shoot = () => {
    const v = video.current
    if (!v || !v.videoWidth) return
    const vw = v.videoWidth, vh = v.videoHeight
    const side = Math.min(vw, vh)
    const sw = square ? side : vw, sh = square ? side : vh
    const scale = Math.min(1, maxSize / Math.max(sw, sh))
    const c = document.createElement('canvas')
    c.width = Math.round(sw * scale)
    c.height = Math.round(sh * scale)
    c.getContext('2d')!.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, c.width, c.height)
    c.toBlob((b) => {
      if (!b) return
      const file = new File([b], `foto-${Date.now()}.jpg`, { type: 'image/jpeg' })
      setPreview(URL.createObjectURL(b))
      setState('shot')
      stop()
      onCapture(file)
    }, 'image/jpeg', 0.85)
  }
  const retake = () => {
    setPreview(null)
    onCapture(null)
    void start(deviceIdx)
  }
  const switchCam = () => {
    const next = ((deviceIdx ?? 0) + 1) % devices.length
    setDeviceIdx(next)
    void start(next)
  }

  const problem = state === 'unsupported' || state === 'denied' || state === 'notfound' || state === 'error'
  return (
    <div className={'cam' + (square ? ' cam-square' : '')}>
      <div className="cam-view" aria-live="polite">
        {/* Videobild ohne Ton; nur Vorschau, keine Aufzeichnung */}
        <video ref={video} playsInline muted aria-label={t('residents.camera.preview')} hidden={state !== 'live' && state !== 'starting'} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {state === 'shot' && preview && <img src={preview} alt={t('residents.camera.taken')} />}
        {state === 'starting' && <span className="cam-msg small muted">{t('residents.camera.starting')}</span>}
        {problem && <p className="cam-msg small" role="alert">{t('residents.camera.' + state)}</p>}
      </div>
      <div className="cam-actions">
        {state === 'live' && <button type="button" className="btn primary" onClick={shoot}>{label ?? t('residents.camera.shoot')}</button>}
        {state === 'live' && devices.length > 1 && <button type="button" className="btn" onClick={switchCam}>{t('residents.camera.switch')}</button>}
        {state === 'shot' && <button type="button" className="btn" onClick={retake}>{t('residents.camera.retake')}</button>}
        {(state === 'denied' || state === 'error') && <button type="button" className="btn" onClick={() => start(deviceIdx)}>{t('residents.camera.retry')}</button>}
      </div>
    </div>
  )
}
