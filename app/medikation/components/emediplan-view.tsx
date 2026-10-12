"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useHeaderResident, useWorkContext } from "@/app/components/care-context";
import { CareOptionSelect } from "@/app/components/care-form-controls";
import HeaderResidentHint from "@/app/components/header-resident-hint";
import ModulePageShell from "@/app/components/module-page-shell";
import { ModuleIcon } from "@/app/components/module-icon";
import {
  EditorDialog,
  PageHeading,
  formatDate,
  formatDateTime,
  requestJson,
  todayInZurich,
  type ShowToast,
} from "@/app/components/workspace-ui";
import {
  EMEDIPLAN_ID_TYPES,
  EMEDIPLAN_SLOTS,
  EMEDIPLAN_SLOT_LABELS,
  dosesBySlot,
  type EmediplanLine,
  type EmediplanSlot,
} from "@/lib/emediplan-shared";
import type { EmediplanReading } from "@/lib/emediplan-review";

type SlotTimes = Record<EmediplanSlot, string>;
const TIMES_KEY = "carecore:emediplan-times";
const NEW = "__new__";

function storedTimes(): SlotTimes {
  const empty = { morning: "", noon: "", evening: "", night: "" };
  try {
    const value = JSON.parse(window.localStorage.getItem(TIMES_KEY) ?? "null") as Partial<SlotTimes> | null;
    return { ...empty, ...(value ?? {}) };
  } catch {
    return empty;
  }
}

const number = (value: number) => value.toLocaleString("de-CH", { maximumFractionDigits: 3 });

// Eine Verordnung: Dosis mit Tageszeiten (Uhrzeiten der Einrichtung) oder festen Uhrzeiten aus dem Plan.
type Group = { amount: string; slots: EmediplanSlot[]; fixed: string[] | null };

function LineCard({
  line,
  reading,
  residentId,
  times,
  onAdopted,
}: {
  line: EmediplanLine;
  reading: EmediplanReading;
  residentId: string;
  times: SlotTimes;
  onAdopted: (message: string) => void;
}) {
  const [medicationId, setMedicationId] = useState(line.match?.id ?? NEW);
  const [name, setName] = useState(line.freeText ?? "");
  const [strength, setStrength] = useState("");
  const [form, setForm] = useState("");
  const [route, setRoute] = useState(line.route || "oral");
  const [prescribedBy, setPrescribedBy] = useState(line.prescribedBy);
  const [indication, setIndication] = useState(line.reason);
  const [groups, setGroups] = useState<Group[]>(() => {
    const amount = (dose: number) => [number(dose), line.unit].filter(Boolean).join(" ");
    if (line.timedDoses) {
      const byDose = new Map<number, string[]>();
      for (const entry of line.timedDoses) byDose.set(entry.dose, [...(byDose.get(entry.dose) ?? []), entry.time]);
      return [...byDose].map(([dose, fixed]) => ({ amount: amount(dose), slots: [], fixed }));
    }
    const planned = (line.doses ? dosesBySlot(line.doses) : []).map((group) => ({
      amount: amount(group.dose),
      slots: group.slots,
      fixed: null,
    }));
    return planned.length ? planned : [{ amount: "", slots: [], fixed: null }];
  });
  const [maxDoses, setMaxDoses] = useState("");
  const [minInterval, setMinInterval] = useState("");
  const [adopted, setAdopted] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const chosen = reading.medications.find((item) => item.id === medicationId);
  const total = line.reserve ? 1 : groups.length;
  const done = adopted >= total;

  const setGroup = (index: number, change: Partial<Group>) =>
    setGroups((current) => current.map((group, i) => (i === index ? { ...group, ...change } : group)));

  async function adopt() {
    setSaving(true);
    setError("");
    const product = chosen
      ? { name: chosen.name, strength: chosen.strength, form: chosen.form }
      : { name, strength, form };
    const base = {
      residentId,
      ...product,
      route,
      prescribedBy,
      indication,
      startOn: line.from ?? todayInZurich(),
      endOn: line.to,
      idType: line.idType,
      code: line.idType === 2 || line.idType === 3 ? line.id : "",
    };
    try {
      if (line.reserve) {
        await requestJson("/api/medication/emediplan/adopt", {
          method: "POST",
          body: {
            ...base,
            isPrn: true,
            amount: groups[0].amount,
            maxDosesPer24h: Number(maxDoses),
            minIntervalHours: Number(minInterval.replace(",", ".")),
            prnInstructions: line.instructions,
          },
        });
        setAdopted(1);
      } else {
        for (const [index, group] of groups.entries()) {
          if (index < adopted) continue;
          const missing = group.fixed ? [] : group.slots.filter((slot) => !times[slot]);
          if (missing.length)
            throw new Error(
              `Bitte oben die Uhrzeit für ${missing.map((slot) => EMEDIPLAN_SLOT_LABELS[slot]).join(", ")} festlegen.`,
            );
          await requestJson("/api/medication/emediplan/adopt", {
            method: "POST",
            body: {
              ...base,
              isPrn: false,
              amount: group.amount,
              times: group.fixed ?? group.slots.map((slot) => times[slot]),
              prnInstructions: line.instructions,
            },
          });
          setAdopted(index + 1);
        }
      }
      onAdopted(`${product.name || "Präparat"} als Verordnung übernommen`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Übernehmen fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  const code = line.idType === 1 ? null : `${EMEDIPLAN_ID_TYPES[line.idType] ?? "Kennung"} ${line.id}`;
  return (
    <article className={`card emediplan-line ${done ? "done" : ""}`} aria-label={`Zeile ${line.index + 1}`}>
      <header>
        <div>
          <p className="eyebrow">
            Zeile {line.index + 1}
            {line.reserve ? " · Reserve" : ""}
            {line.selfMedication ? " · Selbstmedikation" : ""}
          </p>
          <h2 className="card-title">{line.freeText || code}</h2>
          <p className="card-subtitle">
            {[
              line.freeText && code,
              line.unit && `Einheit ${line.unit}`,
              line.route && `Anwendung ${line.route}`,
              line.from && `ab ${formatDate(line.from)}`,
              line.to && `bis ${formatDate(line.to)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {done && (
          <span className="status-badge stable">
            <ModuleIcon name="check" /> Übernommen
          </span>
        )}
      </header>
      <dl className="emediplan-plan">
        <div>
          <dt>Dosierung laut Plan</dt>
          <dd>
            {line.timedDoses
              ? line.timedDoses.map((entry) => `${number(entry.dose)} um ${entry.time}`).join(", ")
              : line.doses
                ? EMEDIPLAN_SLOTS.map((slot) => number(line.doses?.[slot] ?? 0)).join(" – ") + " (Mo – Mi – Ab – Na)"
                : line.reserve
                  ? "Reserve"
                  : "Keine einfache Dosierung angegeben"}
          </dd>
        </div>
        {line.reason && (
          <div>
            <dt>Grund</dt>
            <dd>{line.reason}</dd>
          </div>
        )}
        {line.instructions && (
          <div>
            <dt>Anwendung</dt>
            <dd>{line.instructions}</dd>
          </div>
        )}
      </dl>
      {line.complex ? (
        <p className="emediplan-hint">
          Komplexes Dosierschema oder mehrere Dosierungen: bitte im Medikamentenplan von Hand erfassen.
        </p>
      ) : (
        !done && (
          <div className="area-editor-grid emediplan-form">
            <label className="area-editor-wide">
              <span>Präparat im eigenen Stamm</span>
              <CareOptionSelect
                label="Präparat im eigenen Stamm"
                value={medicationId}
                onChange={setMedicationId}
                options={[
                  { value: NEW, label: "Neues Präparat erfassen" },
                  ...reading.medications.map((item) => ({
                    value: item.id,
                    label: [item.name, item.strength, item.form].filter(Boolean).join(" · "),
                  })),
                ]}
              />
            </label>
            {!chosen && (
              <>
                <label>
                  <span>Präparat</span>
                  <input maxLength={220} value={name} onChange={(event) => setName(event.target.value)} />
                </label>
                <label>
                  <span>Stärke</span>
                  <input maxLength={80} value={strength} onChange={(event) => setStrength(event.target.value)} />
                </label>
                <label>
                  <span>Form</span>
                  <input maxLength={80} value={form} onChange={(event) => setForm(event.target.value)} />
                </label>
              </>
            )}
            <label>
              <span>Anwendung</span>
              <input maxLength={80} value={route} onChange={(event) => setRoute(event.target.value)} />
            </label>
            {line.reserve ? (
              <>
                <label>
                  <span>Dosis je Gabe</span>
                  <input
                    maxLength={120}
                    value={groups[0].amount}
                    onChange={(event) => setGroup(0, { amount: event.target.value })}
                  />
                </label>
                <label>
                  <span>Höchstens Gaben je 24 h</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={24}
                    value={maxDoses}
                    onChange={(event) => setMaxDoses(event.target.value)}
                  />
                </label>
                <label>
                  <span>Mindestabstand (Stunden)</span>
                  <input
                    inputMode="decimal"
                    value={minInterval}
                    onChange={(event) => setMinInterval(event.target.value)}
                  />
                </label>
              </>
            ) : (
              groups.map((group, index) => (
                <div className="area-editor-wide emediplan-group" key={index}>
                  <label>
                    <span>{groups.length > 1 ? `Dosis (Verordnung ${index + 1})` : "Dosis"}</span>
                    <input
                      maxLength={120}
                      value={group.amount}
                      disabled={index < adopted}
                      onChange={(event) => setGroup(index, { amount: event.target.value })}
                    />
                  </label>
                  {group.fixed ? (
                    <div className="form-field">
                      <span>Uhrzeiten laut Plan</span>
                      <div className="chip-row">
                        {group.fixed.map((time) => (
                          <span key={time} className="day-toggle active">
                            {time}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="form-field">
                      <span>Tageszeiten</span>
                      <div className="chip-row">
                        {EMEDIPLAN_SLOTS.map((slot) => (
                          <button
                            key={slot}
                            type="button"
                            className={`day-toggle ${group.slots.includes(slot) ? "active" : ""}`}
                            aria-pressed={group.slots.includes(slot)}
                            disabled={index < adopted}
                            onClick={() =>
                              setGroup(index, {
                                slots: group.slots.includes(slot)
                                  ? group.slots.filter((item) => item !== slot)
                                  : [...group.slots, slot],
                              })
                            }
                          >
                            {EMEDIPLAN_SLOT_LABELS[slot]}
                            {times[slot] ? ` ${times[slot]}` : ""}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
            <label>
              <span>{line.reserve ? "Indikation" : "Grund (optional)"}</span>
              <input maxLength={240} value={indication} onChange={(event) => setIndication(event.target.value)} />
            </label>
            <label>
              <span>Verordnet von</span>
              <input
                maxLength={160}
                value={prescribedBy}
                onChange={(event) => setPrescribedBy(event.target.value)}
                placeholder="Name der Ärztin bzw. des Arztes"
              />
            </label>
            {error && (
              <p className="appointment-editor-error area-editor-wide" role="alert">
                {error}
              </p>
            )}
            <footer className="area-editor-wide emediplan-actions">
              <button className="primary-button" type="button" disabled={saving} onClick={() => void adopt()}>
                <ModuleIcon name="check" className="button-icon" />
                {saving
                  ? "Wird übernommen…"
                  : total > 1
                    ? `Geprüft – als ${total} Verordnungen übernehmen`
                    : "Geprüft – als Verordnung übernehmen"}
              </button>
            </footer>
          </div>
        )
      )}
    </article>
  );
}

// QR-Code mit der Kamera lesen (BarcodeDetector des Browsers, z. B. Chrome, Edge, Android). Die Bilder verlassen das
// Gerät nicht; nur der gelesene Text kommt ins Feld.
type Detector = { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> };
type DetectorClass = new (options: { formats: string[] }) => Detector;
const detectorClass = () =>
  typeof window === "undefined"
    ? null
    : ((window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector ?? null);
const noSubscription = () => () => {};

function CameraScanner({ onClose, onCode }: { onClose: () => void; onCode: (value: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const found = useRef(onCode);
  useEffect(() => {
    found.current = onCode;
  }, [onCode]);
  useEffect(() => {
    const Ctor = detectorClass();
    if (!Ctor) return;
    const detector = new Ctor({ formats: ["qr_code"] });
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer = 0;
    const scan = async () => {
      if (stopped || !video.current) return;
      try {
        const codes = await detector.detect(video.current);
        const value = codes.map((code) => code.rawValue).find((raw) => /^CHMED/i.test(raw));
        if (value) {
          found.current(value);
          return;
        }
      } catch {
        // Bild noch nicht bereit: beim nächsten Durchgang erneut versuchen.
      }
      timer = window.setTimeout(() => void scan(), 300);
    };
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((media) => {
        stream = media;
        if (stopped || !video.current) return;
        video.current.srcObject = media;
        void video.current.play().then(() => void scan());
      })
      .catch(() => setError("Kein Zugriff auf die Kamera. Bitte im Browser erlauben oder den QR-Scanner verwenden."));
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  return (
    <EditorDialog
      id="emediplan-camera"
      eyebrow="eMediplan"
      title="QR-Code scannen"
      description="Den QR-Code des eMediplans vor die Kamera halten. Bei mehreren QR-Codes jeden einzeln scannen."
      onClose={onClose}
      onSubmit={onClose}
      saving={false}
      error={error}
      submitLabel="Schliessen"
    >
      <video ref={video} className="emediplan-video area-editor-wide" muted playsInline aria-label="Kamerabild" />
    </EditorDialog>
  );
}

function EmediplanContent({ showToast }: { showToast: ShowToast }) {
  const context = useWorkContext();
  const { resident, missing } = useHeaderResident(context?.residents ?? [], !context);
  const [code, setCode] = useState("");
  const [reading, setReading] = useState<EmediplanReading | null>(null);
  const [readFor, setReadFor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [times, setTimes] = useState<SlotTimes>(storedTimes);
  const current = reading && readFor === resident?.id ? reading : null;
  const cameraSupported = useSyncExternalStore(
    noSubscription,
    () => detectorClass() !== null,
    () => false,
  );
  const [scanning, setScanning] = useState(false);

  function setTime(slot: EmediplanSlot, value: string) {
    const next = { ...times, [slot]: value };
    setTimes(next);
    try {
      window.localStorage.setItem(TIMES_KEY, JSON.stringify(next));
    } catch {
      // Ohne Speicher im Browser gelten die Zeiten nur für diese Sitzung.
    }
  }

  async function read() {
    if (!resident) return;
    setLoading(true);
    setError("");
    try {
      const result = await requestJson<EmediplanReading>("/api/medication/emediplan", {
        method: "POST",
        body: { residentId: resident.id, code },
      });
      setReading(result);
      setReadFor(resident.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Einlesen fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="Medikamente"
        title="eMediplan einlesen"
        description="Medikationsplan (Schweizer Formate CHMED16A und CHMED23A) aus dem QR-Code als Entwurf übernehmen. Jede Zeile prüft eine Fachperson und gibt sie einzeln als Verordnung frei – CareOS prüft und ändert nichts selbst."
      />
      {!resident ? (
        <HeaderResidentHint loading={!context} missing={missing} />
      ) : (
        <>
          <section className="card emediplan-input" aria-label="eMediplan-Code">
            <label>
              <span>Inhalt des QR-Codes für {resident.name}</span>
              <textarea
                rows={4}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="Mit dem QR-Scanner hierhin scannen oder den Text (beginnt mit CHMED) einfügen. Besteht der Plan aus mehreren QR-Codes, jeden auf eine eigene Zeile."
                spellCheck={false}
              />
            </label>
            {error && (
              <p className="appointment-editor-error" role="alert">
                {error}
              </p>
            )}
            <div className="emediplan-actions">
              {cameraSupported && (
                <button className="secondary-button" type="button" onClick={() => setScanning(true)}>
                  Mit Kamera scannen
                </button>
              )}
              <button
                className="primary-button"
                type="button"
                disabled={loading || !code.trim()}
                onClick={() => void read()}
              >
                <ModuleIcon name="docs" className="button-icon" />
                {loading ? "Wird gelesen…" : "Einlesen"}
              </button>
            </div>
          </section>

          {scanning && (
            <CameraScanner
              onClose={() => setScanning(false)}
              onCode={(value) => {
                setCode((current) =>
                  current.includes(value) ? current : [current.trim(), value].filter(Boolean).join("\n"),
                );
                setScanning(false);
                showToast("QR-Code erfasst");
              }}
            />
          )}

          {current && (
            <>
              <section className="card emediplan-summary" aria-label="Angaben des Plans">
                <header>
                  <h2 className="card-title">
                    Plan für {[current.patient.firstName, current.patient.lastName].filter(Boolean).join(" ") || "–"}
                  </h2>
                  <p className="card-subtitle">
                    {[
                      current.patient.birthDate && `geb. ${formatDate(current.patient.birthDate)}`,
                      current.issuedAt && `erstellt ${formatDateTime(current.issuedAt)}`,
                      current.author && `von ${current.author}`,
                      `${current.lines.length} Zeilen`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </header>
                {current.patientMismatch.length > 0 && (
                  <div className="emediplan-mismatch" role="alert">
                    <strong>Der Plan passt nicht eindeutig zur gewählten Person.</strong>
                    {current.patientMismatch.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                )}
                {current.remark && <p className="emediplan-remark">Bemerkung im Plan: {current.remark}</p>}
                <div className="emediplan-times">
                  <p>Uhrzeiten der Einrichtung für Morgen, Mittag, Abend und Nacht (gelten für diese Übernahme):</p>
                  <div>
                    {EMEDIPLAN_SLOTS.map((slot) => (
                      <label key={slot}>
                        <span>{EMEDIPLAN_SLOT_LABELS[slot]}</span>
                        <input
                          type="time"
                          value={times[slot]}
                          onChange={(event) => setTime(slot, event.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <p className="emediplan-remark">
                  GTIN und Pharmacode löst CareOS ohne Arzneimitteldatenbank nicht auf: Beim ersten Mal wird das
                  Präparat zugeordnet oder erfasst; die Zuordnung gilt danach für den nächsten eMediplan.
                </p>
              </section>
              <div className="emediplan-lines">
                {current.lines.map((line) => (
                  <LineCard
                    key={`${readFor}-${line.index}`}
                    line={line}
                    reading={current}
                    residentId={resident.id}
                    times={times}
                    onAdopted={showToast}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

// Medikation › eMediplan: QR-Code lesen, Zeilen prüfen und einzeln übernehmen.
export default function EmediplanView() {
  return (
    <ModulePageShell activeModule="med" activeChild="eMediplan" pageClass="medication-page emediplan-page">
      {(showToast) => (
        <main className="workspace module-workspace emediplan-workspace">
          <EmediplanContent showToast={showToast} />
        </main>
      )}
    </ModulePageShell>
  );
}
