import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'
import { THEME_COOKIE, normalizeTheme } from '@/lib/theme'
import { getSession } from '@/lib/auth/session'
import { pickLocale } from '@/i18n/core'
import { headers } from 'next/headers'
// Schriften selbst gehostet (npm) – keine Anfragen an Drittanbieter aus dem Browser (Datenschutz).
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-sans-condensed/latin-500.css'
import '@fontsource/ibm-plex-sans-condensed/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './globals.css'
import { ServiceWorker } from '@/components/shell/ServiceWorker'

export const metadata: Metadata = {
  title: { default: 'CareOS', template: '%s · CareOS' },
  description: 'Die Arbeitsplattform für Pflegeorganisationen',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#EEF1F2' },
    { media: '(prefers-color-scheme: dark)', color: '#0D1317' },
  ],
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies()
  const session = await getSession()
  const theme = normalizeTheme(session?.user.theme ?? jar.get(THEME_COOKIE)?.value)
  const lang = session?.user.locale ?? pickLocale(jar.get('careos_locale')?.value ?? (await headers()).get('accept-language'))
  return (
    <html lang={lang} data-theme={theme} suppressHydrationWarning>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  )
}
