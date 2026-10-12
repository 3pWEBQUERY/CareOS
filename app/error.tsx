"use client";

import { useEffect } from "react";
import { StatusPage } from "./components/status-page";

// Unexpected error on a page: the rest of CareOS keeps working, the page can be retried.
export default function PageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <StatusPage
      code="Fehler"
      title="Diese Seite konnte nicht geladen werden"
      text={`Es ist ein unerwarteter Fehler aufgetreten. Eingaben, die bereits gespeichert wurden, bleiben erhalten.${
        error.digest ? ` Fehlercode: ${error.digest}` : ""
      }`}
    >
      <button className="primary-button" type="button" onClick={() => retry()}>
        Erneut versuchen
      </button>
    </StatusPage>
  );
}
