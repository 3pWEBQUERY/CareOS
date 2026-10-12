// Herkunft eines Protokolleintrags: Sitzung und Gerät (Browser-Kennung) der handelnden Person.
// Handelnde aus der Anmeldung tragen beides mit; Hintergrundläufe und Tests haben keine Sitzung (null).
export type AuditActor = { id: string; session_id?: string | null; user_agent?: string | null };

export function auditOrigin(actor: unknown) {
  const value = actor && typeof actor === "object" ? (actor as AuditActor) : null;
  return {
    sessionId: typeof value?.session_id === "string" ? value.session_id : null,
    userAgent: typeof value?.user_agent === "string" ? value.user_agent.slice(0, 300) : null,
  };
}

// Short device description from the browser's user agent, e.g. "Safari · iPhone".
export function deviceLabel(userAgent: unknown) {
  const ua = typeof userAgent === "string" ? userAgent : "";
  if (!ua) return "Unbekanntes Gerät";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const system = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  return [browser, system].filter(Boolean).join(" · ");
}
