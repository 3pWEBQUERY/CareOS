import 'server-only'
import { cookies, headers } from 'next/headers'
import { dictionary } from '@/i18n'
import { makeT, pickLocale, type Locale } from '@/i18n/core'

/** Übersetzer für Seiten ohne Sitzung (Login). Sprache aus Cookie oder Browser. */
export async function publicT() {
  const jar = await cookies()
  const locale: Locale = pickLocale(jar.get('careos_locale')?.value ?? (await headers()).get('accept-language'))
  return { locale, t: makeT(dictionary(locale), locale, 'resident') }
}
