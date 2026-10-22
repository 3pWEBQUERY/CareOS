'use client'

/**
 * Datei-Feld mit Ablegen per Drag & Drop, Vorschau (Bilder), Prüfung von Grösse und Typ vor dem Hochladen.
 * Das native <input type="file" name> bleibt das Steuerelement (ein Tab-Stopp, Leertaste öffnet die Auswahl,
 * FormData wie bisher); es ist nur optisch verborgen.
 *
 *   <FileField label="Foto" name="photo" accept="image/*" maxSize={10 * 1024 * 1024} />
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react'
import { useLocale, useT } from '@/i18n/client'
import { INTL_LOCALE } from '@/i18n/core'
import { Field, cx, useFieldIds, type FieldProps } from './Field'

export type FileFieldProps = FieldProps & {
  name?: string
  id?: string
  accept?: string
  multiple?: boolean
  /** Maximale Grösse je Datei in Bytes */
  maxSize?: number
  required?: boolean
  disabled?: boolean
  /** Kamera auf Mobilgeräten (z. B. Wundfoto) */
  capture?: 'user' | 'environment'
  /** Bildvorschau (Standard: an, nur für Bilder) */
  preview?: boolean
  /** Kurzer Text der erlaubten Typen (Standard: aus accept abgeleitet) */
  typesLabel?: string
  /** Beschriftung des Auswahlknopfs (Standard: «Datei wählen»), z. B. «Foto aufnehmen» */
  chooseLabel?: string
  onFiles?: (files: File[]) => void
  className?: string
  style?: CSSProperties
  form?: string
  'aria-label'?: string
  'aria-describedby'?: string
  ref?: Ref<HTMLInputElement>
  children?: ReactNode
}

export function formatBytes(n: number, locale: string) {
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: i === 0 || v >= 10 ? 0 : 1 }).format(v) + ' ' + u[i]
}

/** Passt die Datei zu accept («image/*», «.pdf», «application/pdf»)? */
export function acceptsFile(file: { name: string; type: string }, accept?: string) {
  if (!accept) return true
  const name = file.name.toLowerCase()
  const type = (file.type || '').toLowerCase()
  return accept.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).some((a) =>
    a.startsWith('.') ? name.endsWith(a) : a.endsWith('/*') ? type.startsWith(a.slice(0, -1)) : type === a)
}

function typesFromAccept(accept?: string) {
  if (!accept) return ''
  return accept.split(',').map((s) => s.trim()).map((a) => a === 'image/*' ? 'JPG, PNG' : a.startsWith('.') ? a.slice(1).toUpperCase() : (a.split('/')[1] ?? a).replace('jpeg', 'JPG').replace(/^vnd\..*$/, '').toUpperCase())
    .filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(', ')
}

export function FileField(props: FileFieldProps) {
  const { name, accept, multiple, maxSize, required, disabled, capture, preview = true, onFiles, className, style, form, ref, chooseLabel } = props
  const t = useT()
  const locale = useLocale()
  const loc = INTL_LOCALE[locale]
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [urls, setUrls] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const f: FieldProps = { label: props.label, hideLabel: props.hideLabel, hint: props.hint, error: props.error ?? err, optional: props.optional, wrapClassName: props.wrapClassName, wrapStyle: props.wrapStyle }
  const ids = useFieldIds(f, { id: props.id, 'aria-describedby': props['aria-describedby'] })
  const limitsId = ids.id + '-x'
  const types = props.typesLabel ?? typesFromAccept(accept)
  const limits = [types, maxSize ? t('common.field.fileMax', { max: formatBytes(maxSize, loc) }) : ''].filter(Boolean).join(' · ')

  // Vorschau-URLs freigeben
  useEffect(() => {
    if (!preview) return
    const u = files.map((x) => (x.type.startsWith('image/') ? URL.createObjectURL(x) : ''))
    setUrls(u)
    return () => u.forEach((x) => x && URL.revokeObjectURL(x))
  }, [files, preview])

  // Formular-Reset
  useEffect(() => {
    const fm = inputRef.current?.form
    if (!fm) return
    const onReset = () => { setFiles([]); setErr(null) }
    fm.addEventListener('reset', onReset)
    return () => fm.removeEventListener('reset', onReset)
  }, [])

  /** Prüft und übernimmt Dateien ins native Feld; ungültige werden nicht übernommen. */
  const take = (list: File[]) => {
    const el = inputRef.current
    if (!el) return
    let msg: string | null = null
    const ok = list.filter((x) => {
      if (!acceptsFile(x, accept)) { msg ??= t('common.field.fileType', { name: x.name }); return false }
      if (maxSize && x.size > maxSize) { msg ??= t('common.field.fileTooLarge', { name: x.name, max: formatBytes(maxSize, loc) }); return false }
      return true
    })
    const keep = multiple ? ok : ok.slice(0, 1)
    const dt = new DataTransfer()
    keep.forEach((x) => dt.items.add(x))
    el.files = dt.files
    setFiles(keep)
    setErr(msg)
    el.setCustomValidity(msg ?? '')
    onFiles?.(keep)
  }

  const remove = (i: number) => {
    take(files.filter((_, k) => k !== i))
    setErr(null)
    inputRef.current?.focus()
  }

  return (
    <Field ids={ids} {...f} label={f.label} hint={f.hint}>
      <div
        className={cx('ff', over && 'is-over', disabled && 'is-disabled', className)}
        style={style}
        onDragOver={(e) => { if (disabled) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true) }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false) }}
        onDrop={(e) => { if (disabled) return; e.preventDefault(); setOver(false); take([...e.dataTransfer.files]) }}
      >
        <input
          ref={(el) => {
            inputRef.current = el
            if (typeof ref === 'function') ref(el)
            else if (ref) (ref as { current: HTMLInputElement | null }).current = el
          }}
          id={ids.id}
          className="ff-native"
          type="file"
          name={name}
          form={form}
          accept={accept}
          multiple={multiple}
          required={required}
          disabled={disabled}
          capture={capture}
          aria-label={props['aria-label']}
          aria-describedby={cx(ids.describedBy, limits && limitsId)}
          aria-invalid={ids.invalid || undefined}
          onChange={(e) => take([...(e.currentTarget.files ?? [])])}
        />
        <div className="ff-drop" aria-hidden="true">
          <span className="ff-cta">{t(multiple ? 'common.field.filesDrop' : 'common.field.fileDrop')}</span>
          <span className="btn sm ff-btn" onClick={() => inputRef.current?.click()}>
            {chooseLabel ?? t(files.length && !multiple ? 'common.field.fileReplace' : multiple ? 'common.field.filesChoose' : 'common.field.fileChoose')}
          </span>
        </div>
        {limits && <span className="ff-limits" id={limitsId}>{limits}</span>}
        {files.length > 0 && (
          <ul className="ff-list" aria-label={t('common.field.fileSelected', { n: files.length })}>
            {files.map((x, i) => (
              <li key={x.name + i} className="ff-item">
                {urls[i] ? <img src={urls[i]} alt="" className="ff-thumb" /> : <span className="ff-thumb ff-doc" aria-hidden="true">{(x.name.split('.').pop() ?? '').slice(0, 4).toUpperCase()}</span>}
                <span className="ff-name">{x.name}</span>
                <span className="ff-size mono">{formatBytes(x.size, loc)}</span>
                <button type="button" className="btn sm ghost" onClick={() => remove(i)} disabled={disabled}>
                  {t('common.field.fileRemove')}<span className="sr-only"> {x.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {props.children}
      </div>
    </Field>
  )
}
