'use client'

/**
 * DateField, TimeField und DateTimeField mit dem gemeinsamen Feld-Rahmen (label, hint, error, optional).
 * Ohne diese Props verhalten sie sich wie die Basiskomponenten in `src/components/ui/`.
 */
import { DateField as BaseDate, type DateFieldProps } from '../DateField'
import { TimeField as BaseTime, type TimeFieldProps } from '../TimeField'
import { DateTimeField as BaseDateTime, type DateTimeFieldProps } from '../DateTimeField'
import { splitField, useFieldIds, wrap, type FieldProps } from './Field'

export function DateField(props: DateFieldProps & FieldProps) {
  const [f, p] = splitField(props)
  const ids = useFieldIds(f, p)
  return wrap(f, ids, <BaseDate {...p} id={ids.wrapped ? ids.id : p.id} aria-describedby={ids.describedBy} aria-invalid={ids.invalid || undefined} />)
}

export function TimeField(props: TimeFieldProps & FieldProps) {
  const [f, p] = splitField(props)
  const ids = useFieldIds(f, p)
  return wrap(f, ids, <BaseTime {...p} id={ids.wrapped ? ids.id : p.id} aria-describedby={ids.describedBy} aria-invalid={ids.invalid || undefined} />)
}

export function DateTimeField(props: DateTimeFieldProps & FieldProps) {
  const [f, p] = splitField(props)
  const ids = useFieldIds(f, p)
  return wrap(f, ids, <BaseDateTime {...p} id={ids.wrapped ? ids.id : p.id} aria-describedby={ids.describedBy} aria-invalid={ids.invalid || undefined} />)
}
