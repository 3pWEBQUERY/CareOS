/**
 * Checkbox, Schalter und Checkbox-Gruppe. Server-kompatibel (native Inputs, Wert «on» bzw. `value`).
 *
 *   <Checkbox name="important" label="Wichtig" defaultChecked />
 *   <Switch name="requireMfa" label="2FA für Admins" hint="…" />           // role="switch", für Ein/Aus-Einstellungen
 *   <CheckboxGroup label="Rollen" name="postRoles" options={[{ value, label }]} defaultValue={['pdl']} />
 */
import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react'
import { cx } from './Field'
import { OptionalMark } from './marks'

type Native = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

export type CheckboxProps = Omit<Native, 'role'> & {
  /** Sichtbarer Text rechts der Box. Ohne label: nur die Box (aria-label setzen). */
  label?: ReactNode
  /** Zusatz unter dem Text. */
  hint?: ReactNode
  error?: ReactNode
  /** Klasse/Stil des umgebenden <label class="check"> */
  wrapClassName?: string
  wrapStyle?: React.CSSProperties
  /** Teilauswahl («alle auswählen»); setzt aria-checked="mixed". Nur clientseitig sinnvoll. */
  mixed?: boolean
  ref?: Ref<HTMLInputElement>
}

function Toggle({ role, label, hint, error, wrapClassName, wrapStyle, className, mixed, ...rest }: Omit<CheckboxProps, 'role'> & { role?: 'switch' }) {
  const uid = useId()
  const id = rest.id ?? 'c' + uid.replace(/[^\w-]/g, '')
  const hasErr = error != null && error !== false && error !== ''
  const describedBy = cx(rest['aria-describedby'], hint != null && id + '-h', hasErr && id + '-e')
  const input = (
    <input
      {...rest}
      id={id}
      type="checkbox"
      role={role}
      className={cx(role === 'switch' ? 'sw' : 'cbx', className)}
      aria-describedby={describedBy}
      aria-invalid={hasErr || rest['aria-invalid'] || undefined}
      aria-checked={mixed ? 'mixed' : rest['aria-checked']}
    />
  )
  if (label == null && hint == null && !hasErr) return input
  const lab = (
    <label className={cx('check', role === 'switch' && 'is-switch', hint == null && !hasErr && wrapClassName)} style={hint == null && !hasErr ? wrapStyle : undefined} htmlFor={id}>
      {input}
      {label != null && <span className="check-lbl">{label}</span>}
    </label>
  )
  if (hint == null && !hasErr) return lab
  return (
    <span className={cx('chk-fld', wrapClassName)} style={wrapStyle}>
      {lab}
      {hint != null && <span className="hint fld-hint" id={id + '-h'}>{hint}</span>}
      {hasErr && <span className="err fld-err" id={id + '-e'} role="alert">{error}</span>}
    </span>
  )
}

export function Checkbox(props: CheckboxProps) {
  return <Toggle {...props} />
}

/** Ein/Aus-Schalter für Einstellungen (role="switch"); im Formular wie eine Checkbox («on»). */
export function Switch(props: CheckboxProps) {
  return <Toggle {...props} role="switch" />
}

export type CheckOption = { value: string; label: ReactNode; hint?: ReactNode; disabled?: boolean }

/** Mehrfachauswahl mit gemeinsamer Beschriftung (role="group"); jede Box sendet `name=value`. */
export function CheckboxGroup({ label, name, options, defaultValue, hint, error, optional, wrapClassName, wrapStyle, inline, disabled, small }: {
  label: ReactNode
  name: string
  options: CheckOption[]
  defaultValue?: string[]
  hint?: ReactNode
  error?: ReactNode
  optional?: boolean
  wrapClassName?: string
  wrapStyle?: React.CSSProperties
  /** nebeneinander statt untereinander */
  inline?: boolean
  disabled?: boolean
  /** kleinere Schrift der Optionen */
  small?: boolean
}) {
  const uid = useId().replace(/[^\w-]/g, '')
  const hasErr = error != null && error !== false && error !== ''
  return (
    <div
      className={cx('fld', 'fld-group', wrapClassName)}
      style={wrapStyle}
      role="group"
      aria-labelledby={uid + '-l'}
      aria-describedby={cx(hint != null && uid + '-h', hasErr && uid + '-e')}
      data-invalid={hasErr || undefined}
    >
      <span className="lbl" id={uid + '-l'}>{label}{optional && <OptionalMark />}</span>
      <div className={inline ? 'row' : 'fld-opts'}>
        {options.map((o) => (
          <Checkbox key={o.value} name={name} value={o.value} label={small ? <span className="small">{o.label}</span> : o.label} hint={o.hint}
            defaultChecked={defaultValue?.includes(o.value)} disabled={disabled || o.disabled} />
        ))}
      </div>
      {hint != null && <p className="hint fld-hint" id={uid + '-h'}>{hint}</p>}
      {hasErr && <p className="err fld-err" id={uid + '-e'} role="alert">{error}</p>}
      <span className="fld-slot" data-err-slot="" />
    </div>
  )
}
