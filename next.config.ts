import type { NextConfig } from "next";

// Sicherheits-Header für alle Antworten. Inhalte kommen nur von CareOS selbst (Schriften sind eingebunden, Medien
// liefert CareOS aus); eingebettet werden darf nur in CareOS (Dateivorschau). Inline-Skripte braucht Next.js
// für statisch erzeugte Seiten; im Entwicklungsmodus zusätzlich eval für die Fehleranzeige von React.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  // Kennung je Deployment (Railway setzt die Commit-Kennung): Geöffnete Fenster einer älteren Fassung laden beim
  // nächsten Seitenwechsel vollständig neu, statt weiter die alten Programmdateien zu verwenden.
  deploymentId: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.NEXT_DEPLOYMENT_ID || undefined,
  // Postgres-Verbindungspool (Railway) nur auf dem Server, nicht gebündelt.
  serverExternalPackages: ["pg"],
  // /api/health vergleicht die angewendeten Migrationen mit den Dateien im Deployment.
  outputFileTracingIncludes: {
    "/api/health": ["./database/migrations/*.sql"],
  },
  // Der Service Worker muss immer frisch geladen werden, sonst bleiben Geräte auf einer alten Fassung.
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
      {
        // Vom Service Worker per importScripts geladen; wird bei jeder Aktualisierung mitgeprüft.
        source: "/sw-crypto.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
  // Der Kompass hiess früher „RAI“: alte Links (auch in Benachrichtigungen) führen weiter.
  async redirects() {
    return [
      { source: "/c/rai/erfassung", destination: "/c/kompass/abklaerung", permanent: true },
      { source: "/c/rai", destination: "/c/kompass", permanent: true },
      { source: "/c/rai/:path*", destination: "/c/kompass/:path*", permanent: true },
    ];
  },
  async rewrites() {
    return [{ source: "/c/:path*", destination: "/:path*" }];
  },
};

export default nextConfig;
