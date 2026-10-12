"use client";

// Error in the root layout: renders its own document, so it carries its own minimal styles.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="de">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          fontFamily: "system-ui, sans-serif",
          color: "#f2f5fa",
          background: "#0f1a33",
        }}
      >
        <title>CareOS · Fehler</title>
        <main style={{ maxWidth: 460, textAlign: "center" }}>
          <h1 style={{ fontSize: 26 }}>CareOS ist gerade nicht erreichbar</h1>
          <p style={{ color: "#a3adbf", lineHeight: 1.5 }}>
            Bitte versuche es in einem Moment erneut.{error.digest ? ` Fehlercode: ${error.digest}` : ""}
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: 12,
              padding: "12px 20px",
              border: 0,
              borderRadius: 999,
              color: "#10131c",
              background: "#f3f4f7",
              fontSize: 15,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Erneut versuchen
          </button>
        </main>
      </body>
    </html>
  );
}
