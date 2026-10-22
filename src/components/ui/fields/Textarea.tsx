/**
 * Mehrzeiliges Textfeld. Server-kompatibel; mit `autoGrow` (wächst mit dem Inhalt bis `maxRows`) oder
 * `counter` (Zeichenzähler, benötigt maxLength) übernimmt ein Client-Teil.
 *
 *   <Textarea label="Beschreibung" name="description" rows={3} maxLength={5000} counter />
 */
import type { Ref, TextareaHTMLAttributes } from 'react'
import { cx, splitField, useFieldIds, wrap, type FieldProps } from './Field'
import { TextareaEnhanced } from './TextareaEnhanced'

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps & {
  /** Höhe passt sich dem Inhalt an (zwischen rows und maxRows). */
  autoGrow?: boolean
  maxRows?: number
  /** Zeichenzähler «n / max» (ab 80 % sichtbar hervorgehoben); nur mit maxLength. */
  counter?: boolean
  /** Ohne .field-Rahmen (Stil kommt vom Kontext, z. B. Verlaufseintrag) */
  plain?: boolean
  ref?: Ref<HTMLTextAreaElement>
}

export function Textarea(props: TextareaProps) {
  const [f, p] = splitField(props)
  const { className, autoGrow, maxRows, counter, plain, ...rest } = p
  const ids = useFieldIds(f, rest)
  const showCounter = !!counter && !!rest.maxLength
  const common = { ...rest, id: ids.id, 'aria-invalid': ids.invalid || undefined, className: cx(!plain && 'field', className) }
  if (autoGrow || showCounter) {
    const describedBy = cx(ids.describedBy, showCounter && ids.id + '-c')
    return wrap(f, ids, <TextareaEnhanced {...common} aria-describedby={describedBy} autoGrow={autoGrow} maxRows={maxRows} counter={showCounter} />)
  }
  return wrap(f, ids, <textarea {...common} aria-describedby={ids.describedBy} />)
}
