/**
 * Einzeiliges Textfeld (text, email, tel, url, password, search). Server-kompatibel; «password» erhält
 * einen Umschalter «Passwort anzeigen» (Client-Teil), «search» ein Lupen-Symbol.
 *
 *   <TextField label="Name" name="name" required maxLength={120} />
 *   <TextField name="q" type="search" aria-label="Suchen" />          // ohne Rahmen
 */
import type { InputHTMLAttributes, Ref } from 'react'
import { cx, splitField, useFieldIds, wrap, type FieldProps } from './Field'
import { PasswordInput } from './PasswordInput'

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & FieldProps & {
  type?: 'text' | 'email' | 'tel' | 'url' | 'password' | 'search'
  ref?: Ref<HTMLInputElement>
}

export function TextField(props: TextFieldProps) {
  const [f, p] = splitField(props)
  const ids = useFieldIds(f, p)
  const { type = 'text', className, ...rest } = p
  const common = {
    ...rest,
    id: ids.id,
    'aria-describedby': ids.describedBy,
    'aria-invalid': ids.invalid || undefined,
  }
  let control
  if (type === 'password') control = <PasswordInput {...common} className={className} />
  else if (type === 'search') {
    // Klasse/Stil (z. B. «grow», Breite) gehören an den Rahmen mit der Lupe
    const { style, ...inp } = common
    control = (
      <span className={cx('srch', className)} style={style}>
        <SearchIcon />
        <input type="search" {...inp} className="field srch-in" />
      </span>
    )
  } else control = <input type={type} {...common} className={cx('field', className)} />
  return wrap(f, ids, control)
}

/** Suchfeld (type=search mit Lupe); gleiche Props wie TextField. */
export function SearchField(props: Omit<TextFieldProps, 'type'>) {
  return <TextField {...props} type="search" />
}

export function SearchIcon() {
  return (
    <svg className="srch-ico" width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" />
    </svg>
  )
}
