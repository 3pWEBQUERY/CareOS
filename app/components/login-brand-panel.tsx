import Link from "next/link";
import { Pulse } from "@phosphor-icons/react";
import { SideClock } from "./top-navigation";

// Bühne der Anmeldung (auch „Passwort setzen“): oben das Zeichen von CareOS und die Wahl zwischen Mitarbeitenden-
// Anmeldung und Portal, links die grosse Uhr, in der Mitte die Begrüssung als Sprechblasen über dem Formular.
// Die Teile liegen direkt im Raster der Seite (.login-page).
export function LoginBrandPanel({ active = "staff" }: { active?: "staff" | "portal" }) {
  return (
    <>
      <header className="login-topbar">
        <span className="careos-home-button login-mark" aria-label="CareOS">
          <Pulse weight="bold" />
        </span>
        <nav className="careos-switcher login-switcher" aria-label="Zugang">
          <Link href="/" className="careos-switcher-item" data-active={active === "staff"}>
            Anmelden
          </Link>
          <Link href="/portal" className="careos-switcher-item" data-active={active === "portal"}>
            Portal
          </Link>
        </nav>
        <span className="login-topbar-end" aria-hidden="true" />
      </header>
      <SideClock className="login-clock" />
      <div className="login-bubbles" aria-label="CareOS">
        <p className="careos-bubble">Hallo, ich bin CareOS.</p>
        <p className="careos-bubble">
          Ich halte Bewohner, Dokumentation, Medikamente, Dienstplan und Übergaben für dein Team an einem Ort bereit –
          sicher und auf jedem Gerät.
        </p>
        <p className="careos-bubble">Melde dich an, dann fangen wir dort an, wo du aufgehört hast.</p>
      </div>
      <footer className="login-footnote">CareOS · Das Betriebssystem für die Pflege</footer>
    </>
  );
}
