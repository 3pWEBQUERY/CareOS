'use client'

import { useState, type InputHTMLAttributes, type Ref } from 'react'
import { useT } from '@/i18n/client'
import { cx } from './Field'

/** Passwortfeld mit Umschalter «Passwort anzeigen» (aria-pressed); nach dem Absenden wieder verborgen. */
export function PasswordInput({ className, ref, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { ref?: Ref<HTMLInputElement> }) {
  const t = useT()
  const [show, setShow] = useState(false)
  return (
    <span className="pw">
      <input
        ref={ref}
        {...rest}
        type={show ? 'text' : 'password'}
        className={cx('field', 'pw-in', className)}
        autoCapitalize="off"
        spellCheck={false}
        onBlur={(e) => {
          rest.onBlur?.(e)
          // Formular wird abgesendet → Klartext nicht stehen lassen
          if (show && e.relatedTarget instanceof HTMLButtonElement && e.relatedTarget.type === 'submit') setShow(false)
        }}
      />
      <button
        type="button"
        className="pw-btn"
        aria-label={t(show ? 'common.field.hidePassword' : 'common.field.showPassword')}
        aria-pressed={show}
        aria-controls={rest.id}
        disabled={rest.disabled}
        onClick={() => setShow((s) => !s)}
      >
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1.8 10S4.8 4.5 10 4.5 18.2 10 18.2 10 15.2 15.5 10 15.5 1.8 10 1.8 10Z" /><circle cx="10" cy="10" r="2.6" />
          {show && <path d="M3 3l14 14" />}
        </svg>
      </button>
    </span>
  )
}
