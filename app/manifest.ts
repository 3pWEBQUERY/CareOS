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
    background_color: "#f3f7fc",
    theme_color: "#0b1f3a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
