'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Ref, type TextareaHTMLAttributes } from 'react'
import { useT } from '@/i18n/client'

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { autoGrow?: boolean; maxRows?: number; counter?: boolean; ref?: Ref<HTMLTextAreaElement> }

/** Client-Teil von Textarea: Höhe nach Inhalt und Zeichenzähler (auch nach Formular-Reset korrekt). */
export function TextareaEnhanced({ autoGrow, maxRows = 14, counter, ref, ...rest }: Props) {
  const t = useT()
  const inner = useRef<HTMLTextAreaElement | null>(null)
  const [len, setLen] = useState(() => String(rest.value ?? rest.defaultValue ?? '').length)
  const setRef = useCallback((el: HTMLTextAreaElement | null) => {
    inner.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) (ref as { current: HTMLTextAreaElement | null }).current = el
  }, [ref])

  const fit = useCallback(() => {
    const el = inner.current
    if (!el || !autoGrow) return
    const cs = getComputedStyle(el)
    const line = parseFloat(cs.lineHeight) || 20
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
    el.style.height = 'auto'
    const max = maxRows * line + pad
    el.style.height = Math.min(el.scrollHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth), max) + 'px'
    el.style.overflowY = el.scrollHeight + pad > max ? 'auto' : 'hidden'
  }, [autoGrow, maxRows])

  useLayoutEffect(() => { fit() }, [fit, rest.value])
  useEffect(() => {
    const el = inner.current
    const form = el?.form
    if (!el) return
    setLen(el.value.length)
    const onReset = () => setTimeout(() => { if (inner.current) { setLen(inner.current.value.length); fit() } })
    form?.addEventListener('reset', onReset)
    return () => form?.removeEventListener('reset', onReset)
  }, [fit])

  const max = rest.maxLength ?? 0
  return (
    <>
      <textarea
        ref={setRef}
        {...rest}
        data-autogrow={autoGrow || undefined}
        onChange={(e) => {
          setLen(e.target.value.length)
          fit()
          rest.onChange?.(e)
        }}
      />
      {counter && max > 0 && (
        <p className="fld-count mono" id={rest.id + '-c'} data-near={len >= max * 0.8 || undefined}>
          {t('common.field.chars', { n: len, max })}
        </p>
      )}
    </>
  )
}
