'use client'

import { createContext, useContext, useMemo } from 'react'
import { makeT, type Locale, type Terminology, type TFn, type Tree } from './core'

type Value = { t: TFn; locale: Locale }
const I18nContext = createContext<Value | null>(null)

export function I18nProvider({ locale, terminology, messages, children }: { locale: Locale; terminology: Terminology; messages: Tree; children: React.ReactNode }) {
  const value = useMemo(() => ({ t: makeT(messages, locale, terminology), locale }), [messages, locale, terminology])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/** Übersetzer in Client-Komponenten. Schlüssel wie auf dem Server: "namespace.pfad". */
export function useT() {
  const v = useContext(I18nContext)
  if (!v) throw new Error('useT outside I18nProvider')
  return v.t
}
export function useLocale() {
  return useContext(I18nContext)?.locale ?? 'de'
}
