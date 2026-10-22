/**
 * Auswahlliste (natives <select>, gestylt über .field). Server-kompatibel. Für lange, durchsuchbare
 * Listen (Personen, Mitarbeitende, Medikamente, Räume) `Combobox` verwenden.
 *
 *   <Select label="Rolle" name="roleId" required placeholder="Bitte wählen">{roles.map(…<option/>)}</Select>
 */
import type { Ref, SelectHTMLAttributes } from 'react'
import { cx, splitField, useFieldIds, wrap, type FieldProps } from './Field'

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & FieldProps & {
  /** Leere erste Option (value=""), z. B. «Bitte wählen» oder «Alle». */
  placeholder?: string
  ref?: Ref<HTMLSelectElement>
}

export function Select(props: SelectProps) {
  const [f, p] = splitField(props)
  const ids = useFieldIds(f, p)
  const { className, placeholder, children, ...rest } = p
  return wrap(f, ids, (
    <select {...rest} id={ids.id} aria-describedby={ids.describedBy} aria-invalid={ids.invalid || undefined} className={cx('field', className)}>
      {placeholder != null && <option value="">{placeholder}</option>}
      {children}
    </select>
  ))
}
