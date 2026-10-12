"use client";

import { openResidentPicker, useTerms } from "./care-context";
import { EmptyState } from "./workspace-ui";

// Shown on resident-centred pages until a resident is chosen in the header.
export default function HeaderResidentHint({
  loading,
  missing,
  text,
}: {
  loading: boolean;
  missing: boolean;
  text?: string;
}) {
  const t = useTerms();
  return (
    <section className="card header-resident-hint">
      <EmptyState
        icon="residents"
        title={
          loading
            ? "Wird geladen …"
            : missing
              ? `Für den gewählten ${t.oneOblique} sind hier keine Daten verfügbar`
              : `Bitte in der Kopfzeile einen ${t.oneOblique} auswählen`
        }
        text={text ?? `Alle Angaben dieser Seite beziehen sich auf den ${t.oneOblique} in der Kopfzeile.`}
      />
      {!loading && (
        <button className="primary-button" type="button" onClick={openResidentPicker}>
          {t.oneOblique} auswählen
        </button>
      )}
    </section>
  );
}
