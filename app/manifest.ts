import type { MetadataRoute } from "next";

// Installierbar auf Tablet und Handy (Startbildschirm); Offline-Verhalten siehe public/sw.js.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CareOS · Pflegearbeitsplatz",
    short_name: "CareOS",
    description: "Der persönliche digitale Arbeitsplatz für moderne Pflege.",
    lang: "de-CH",
    start_url: "/c",
    scope: "/",
    display: "standalone",
    background_color: "#0f1a33",
    theme_color: "#0f1a33",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
