"use client";

import Image from "next/image";
import { useBranding } from "./care-context";

// Kachel oben in der Sidebar (und in der Kopfzeile auf dem Telefon): das Logo der Einrichtung wie ein App-Icon,
// ohne Logo das CareOS-Zeichen. Das Logo steht verkleinert mit Rand in der Kachel.
export function BrandIcon({ size }: { size: number }) {
  const branding = useBranding();
  // Noch unbekannt (erster Besuch, Daten laden): leere Kachel statt eines Logos, das gleich wieder wechselt.
  if (!branding) return <span className="brand-mark" aria-hidden="true" />;
  const logo = branding.logoUpdatedAt;
  if (!logo)
    return (
      <span className="brand-mark" aria-label="CareOS">
        <Image
          className={size === 32 ? "sidebar-brand-logo" : undefined}
          src="/carecore-sidebar-logo.png"
          width={size}
          height={size}
          alt=""
          aria-hidden="true"
          unoptimized
        />
      </span>
    );
  return (
    <span className="brand-mark brand-mark-app">
      <Image
        src={`/api/branding/logo?v=${encodeURIComponent(logo)}`}
        width={96}
        height={96}
        alt={`Logo ${branding.organizationName}`}
        loading="eager"
        unoptimized
      />
    </span>
  );
}
