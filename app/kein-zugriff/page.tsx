import type { Metadata } from "next";
import Link from "next/link";
import { StatusPage } from "../components/status-page";

export const metadata: Metadata = { title: "CareOS · Kein Zugriff", robots: { index: false } };

// Ziel des Proxys, wenn eine Seite direkt aufgerufen wird, die die eigene Rolle nicht öffnen darf. Mit
// ?grund=zwei-faktor fehlt nur die Zwei-Faktor-Anmeldung, die die Einrichtung für Leitung und Administration verlangt.
export default async function NoAccessPage({ searchParams }: { searchParams: Promise<{ grund?: string }> }) {
  const { grund } = await searchParams;
  if (grund === "zwei-faktor")
    return (
      <StatusPage
        code="2FA"
        title="Zwei-Faktor-Anmeldung einrichten"
        text="Die Einrichtung verlangt für Leitung und Administration eine Zwei-Faktor-Anmeldung oder einen Passkey. Sobald du sie eingerichtet hast, stehen dir diese Bereiche wieder zur Verfügung."
      >
        <Link className="primary-button" href="/c/einstellungen/security">
          Jetzt einrichten
        </Link>
      </StatusPage>
    );
  return (
    <StatusPage
      code="403"
      title="Kein Zugriff"
      text="Diese Seite gehört zu einem Bereich, den deine Rolle nicht öffnen darf. Wenn du ihn für deine Arbeit brauchst, wende dich an die Administration."
    />
  );
}
