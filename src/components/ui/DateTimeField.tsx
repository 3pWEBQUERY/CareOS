'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useT } from '@/i18n/client'
import { isIsoDate, isIsoDateTime, isTime, todayIso } from '@/lib/date-input'
import { DateField, type FieldCommon } from './DateField'
import { TimeField } from './TimeField'
import { labelSourceId } from './field-popover'

export type DateTimeFieldProps = FieldCommon & {
  /** YYYY-MM-DDTHH:MM */
  defaultValue?: string
  value?: string
  onChange?: (value: string) => void
  min?: string
  max?: string
  step?: number
}

const split = (v?: string): [string, string] => (isIsoDateTime(v) ? [v.slice(0, 10), v.slice(11)] : ['', ''])

/**
 * Datum + Uhrzeit nebeneinander (ersetzt <input type="datetime-local">). Das versteckte Feld `name`
 * enthält YYYY-MM-DDTHH:MM, sobald beides ausgefüllt ist. Ist ein Teil ausgefüllt, wird der andere Pflicht.
 * min/max gelten für das Datum und – am Grenztag – für die Uhrzeit.
 */
export function DateTimeField(props: DateTimeFieldProps) {
  const { name, id, defaultValue, value: controlled, onChange, required, min, max, step, disabled, className, style, title, autoFocus } = props
  const t = useT()
  const uid = useId()
  const dateId = id ?? uid + 'd'
  const isControlled = controlled !== undefined
  const [initD, initT] = split(defaultValue)
  const [d, setD] = useState(isControlled ? split(controlled)[0] : initD)
  const [tm, setTm] = useState(isControlled ? split(controlled)[1] : initT)
  const combined = isIsoDate(d) && isTime(tm) ? `${d}T${tm}` : ''
  const last = useRef(combined)
  const hiddenRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [labelId, setLabelId] = useState<string | null>(null)

  // Kontrollierter Wert von aussen
  useEffect(() => {
    if (!isControlled || controlled === last.current) return
    const [a, b] = split(controlled)
    last.current = isIsoDateTime(controlled) ? controlled : ''
    setD(a)
    setTm(b)
  }, [controlled, isControlled])

  const emit = (nd: string, nt: string) => {
    const v = isIsoDate(nd) && isTime(nt) ? `${nd}T${nt}` : ''
    if (hiddenRef.current) hiddenRef.current.value = v
    if (v === last.current) return
    last.current = v
    onChange?.(v)
  }

  // Zurücksetzen des Formulars
  useEffect(() => {
    const form = wrapRef.current?.closest('form')
    if (!form || isControlled) return
    const onReset = () => setTimeout(() => { setD(initD); setTm(initT); last.current = initD && initT ? `${initD}T${initT}` : '' })
    form.addEventListener('reset', onReset)
    return () => form.removeEventListener('reset', onReset)
  }, [isControlled, initD, initT])

  // Beide Teile tragen die Beschriftung des Felds plus «Datum» bzw. «Uhrzeit»
  useEffect(() => {
    if (props['aria-labelledby']) return setLabelId(props['aria-labelledby'])
    if (props['aria-label']) return
    setLabelId(labelSourceId(document.getElementById(dateId) as HTMLInputElement | null))
  }, [dateId, props])

  const minD = isIsoDateTime(min) ? min.slice(0, 10) : undefined
  const maxD = isIsoDateTime(max) ? max.slice(0, 10) : undefined
  const minT = isIsoDateTime(min) && d === minD ? min.slice(11) : undefined
  const maxT = isIsoDateTime(max) && d === maxD ? max.slice(11) : undefined
  const part = (key: 'date' | 'time') => {
    const sr = uid + key
    if (props['aria-label']) return { 'aria-label': `${props['aria-label']}, ${t('common.dt.' + key)}` }
    return { 'aria-labelledby': labelId ? `${labelId} ${sr}` : sr }
  }
  const shared = { disabled, 'aria-describedby': props['aria-describedby'], 'aria-invalid': props['aria-invalid'] }

  return (
    <div className={'dtf-pair' + (className ? ' ' + className : '')} style={style} ref={wrapRef} title={title}>
      <span className="sr-only" id={uid + 'date'}>{t('common.dt.date')}</span>
      <span className="sr-only" id={uid + 'time'}>{t('common.dt.time')}</span>
      <DateField
        {...shared}
        {...part('date')}
        id={dateId}
        data-field={name}
        autoFocus={autoFocus}
        value={d}
        min={minD}
        max={maxD}
        required={required || !!tm}
        onChange={(v) => { setD(v); emit(v, tm) }}
      />
      <TimeField
        {...shared}
        {...part('time')}
        id={dateId + '-t'}
        value={tm}
        min={minT}
        max={maxT}
        step={step}
        required={required || !!d}
        onChange={(v) => { setTm(v); emit(d, v) }}
        onNow={(v) => { if (!d) { const td = todayIso(); setD(td); emit(td, v) } }}
      />
      {name && <input ref={hiddenRef} type="hidden" name={name} value={combined} disabled={disabled} data-for={dateId} />}
    </div>
  )
}
