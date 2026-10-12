import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import AppFrame from "./components/app-frame";
import DialogFocus from "./components/dialog-focus";
import OfflineSync from "./components/offline-sync";
import Translator from "./components/translator";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CareOS · Pflegearbeitsplatz",
  description: "Der persönliche digitale Arbeitsplatz für moderne Pflege.",
  appleWebApp: { capable: true, title: "CareOS", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

// Kein automatisches Hineinzoomen in Formularfelder auf Handys (iOS zoomt sonst bei Schrift < 16 px).
// Die Schriftgrössen der App bleiben unverändert.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0b1f3a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: das Skript unten setzt das dunkle Erscheinungsbild vor der Hydrierung.
    <html
      lang="de"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Script id="carecore-theme" strategy="beforeInteractive">
          {`try{if(localStorage.getItem("carecore-theme")==="dark")document.documentElement.classList.add("theme-dark")}catch(e){}`}
        </Script>
        {/* Andere Sprache als Deutsch: Seite kurz verbergen, bis die Übersetzung angewendet ist (höchstens 1,5 s). */}
        <Script id="carecore-language" strategy="beforeInteractive">
          {`try{var l=localStorage.getItem("carecore-language");if(l&&l!=="de"){var d=document.documentElement;d.classList.add("i18n-pending");setTimeout(function(){d.classList.remove("i18n-pending")},1500)}}catch(e){}`}
        </Script>
        <AppFrame>{children}</AppFrame>
        <OfflineSync />
        <Translator />
        <DialogFocus />
      </body>
    </html>
  );
}
