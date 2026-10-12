"use client";

import { useEffect, useState } from "react";
import ModulePageShell from "@/app/components/module-page-shell";
import { requestJson } from "@/app/components/workspace-ui";
import { toCsv } from "@/lib/csv-import";
import type { ImportKind, ImportPreview, ImportResult } from "@/lib/data-import";

type ShowToast = (message: string) => void;

const KINDS: Array<[ImportKind, string]> = [
  ["residents", "Bewohnerinnen und Bewohner"],
  ["staff", "Mitarbeitende"],
];

// Leitung › Administration › Datenübernahme: beim Umstieg Bewohner und Mitarbeitende aus einer CSV-Datei übernehmen.
export default function DataImportAdmin() {
  return (
    <ModulePageShell
      activeModule="admin"
      activeChild="Datenübernahme"
      pageClass="leadership-page leadership-users data-import-page"
    >
      {(showToast) => <DataImportBody showToast={showToast} />}
    </ModulePageShell>
  );
}

function DataImportBody({ showToast }: { showToast: ShowToast }) {
  const [kind, setKind] = useState<ImportKind>("residents");
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Gültige Namen für die Spalte „Wohnbereich“.
  const [units, setUnits] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    requestJson<{ units: Array<{ name: string; active: boolean }> }>("/api/organization")
      .then((data) => live && setUnits(data.units.filter((unit) => unit.active).map((unit) => unit.name)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const reset = (next: ImportKind) => {
    setKind(next);
    setFileName("");
    setCsv("");
    setPreview(null);
    setResult(null);
    setError("");
  };

  const send = async (text: string, commit: boolean) => {
    setBusy(true);
    setError("");
    try {
      if (commit) {
        const done = await requestJson<ImportResult>("/api/admin/import", {
          method: "POST",
          body: { kind, csv: text, commit: true },
        });
        setResult(done);
        setPreview(null);
        showToast(`${done.created} ${kind === "residents" ? "Personen" : "Mitarbeitende"} übernommen`);
      } else
        setPreview(
          await requestJson<ImportPreview>("/api/admin/import", { method: "POST", body: { kind, csv: text } }),
        );
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "Die Datenübernahme ist fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setResult(null);
    setFileName(file.name);
    const text = await file.text();
    setCsv(text);
    await send(text, false);
  };

  const downloadPasswords = () => {
    if (!result) return;
    const blob = new Blob(
      [
        toCsv([
          ["Name", "Benutzername", "Startpasswort"],
          ...result.startPasswords.map((p) => [p.name, p.username, p.password]),
        ]),
      ],
      { type: "text/csv;charset=utf-8" },
    );
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "carecore-startpasswoerter.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const columns = preview?.columns.slice(0, 4) ?? [];
  return (
    <main className="workspace leadership-workspace leadership-users data-import">
      <header className="leadership-heading page-heading">
        <div className="heading-copy">
          <p className="eyebrow">Administration</p>
          <h1>Datenübernahme</h1>
          <p>
            Beim Umstieg Bewohnerinnen, Bewohner und Mitarbeitende aus einer CSV-Datei übernehmen. Erst prüft CareOS
            jede Zeile; übernommen wird erst, wenn alle Zeilen stimmen.
          </p>
        </div>
      </header>

      <section className="card admin-terminology-card" aria-labelledby="import-file-title">
        <div className="card-header">
          <div>
            <p className="eyebrow">Schritt 1</p>
            <h2 className="card-title" id="import-file-title">
              Datei wählen
            </h2>
            <p className="card-subtitle">
              Vorlage herunterladen, in Excel ausfüllen und als CSV speichern (Trennzeichen Semikolon oder Komma). Datum
              als TT.MM.JJJJ.
            </p>
            {units.length > 0 && <p className="card-subtitle data-import-units">Wohnbereiche: {units.join(" · ")}</p>}
          </div>
        </div>
        <div className="admin-branding-body">
          <div className="care-supply-filters" role="group" aria-label="Was übernehmen?">
            {KINDS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={kind === value ? "active" : ""}
                aria-pressed={kind === value}
                onClick={() => reset(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <a className="secondary-button" href={`/api/admin/import?kind=${kind}`} download>
            Vorlage herunterladen
          </a>
          <label className="secondary-button admin-branding-upload">
            CSV-Datei wählen
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                void choose(file);
              }}
            />
          </label>
          {fileName && <span className="data-import-file">{fileName}</span>}
        </div>
        {error && (
          <p className="data-import-error" role="alert">
            {error}
          </p>
        )}
      </section>

      {preview && (
        <section className="card admin-terminology-card" aria-labelledby="import-preview-title">
          <div className="card-header">
            <div>
              <p className="eyebrow">Schritt 2</p>
              <h2 className="card-title" id="import-preview-title">
                Prüfen und übernehmen
              </h2>
              <p className="card-subtitle">
                {preview.valid} von {preview.rows.length} Zeilen in Ordnung
                {preview.invalid
                  ? ` · ${preview.invalid} mit Fehlern – bitte in der Datei korrigieren und neu wählen`
                  : ""}
              </p>
            </div>
            <button
              className="primary-button"
              type="button"
              disabled={busy || preview.invalid > 0}
              onClick={() => void send(csv, true)}
            >
              {preview.rows.length} übernehmen
            </button>
          </div>
          <div className="data-import-table" role="table" aria-label="Vorschau der Datei">
            <div className="data-import-row data-import-head" role="row">
              <span role="columnheader">Zeile</span>
              {columns.map((column) => (
                <span role="columnheader" key={column.key}>
                  {column.label}
                </span>
              ))}
              <span role="columnheader">Prüfung</span>
            </div>
            {preview.rows.map((row) => (
              <div className={`data-import-row ${row.errors.length ? "has-errors" : ""}`} role="row" key={row.line}>
                <span role="cell">{row.line}</span>
                {columns.map((column) => (
                  <span role="cell" key={column.key}>
                    {row.values[column.key]}
                  </span>
                ))}
                <span role="cell">{row.errors.length ? row.errors.join(" · ") : "In Ordnung"}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {result && (
        <section className="card admin-terminology-card" aria-labelledby="import-result-title">
          <div className="card-header">
            <div>
              <p className="eyebrow">Erledigt</p>
              <h2 className="card-title" id="import-result-title">
                {result.created} übernommen
              </h2>
              <p className="card-subtitle">
                {kind === "residents"
                  ? "Die Akten sind angelegt; Bezugspflege, Kontakte und Medikation lassen sich jetzt in der Akte ergänzen."
                  : `${result.invited} per E-Mail eingeladen${
                      result.startPasswords.length ? ` · ${result.startPasswords.length} mit Startpasswort` : ""
                    }.`}
              </p>
            </div>
          </div>
          {result.startPasswords.length > 0 && (
            <div className="admin-branding-body">
              <p className="data-import-note">
                Die Startpasswörter stehen nur jetzt zur Verfügung und werden nirgends gespeichert. Liste herunterladen,
                sicher weitergeben und danach löschen; beim ersten Anmelden das Passwort unter Einstellungen ›
                Sicherheit ändern.
              </p>
              <button className="secondary-button" type="button" onClick={downloadPasswords}>
                Startpasswörter herunterladen
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
