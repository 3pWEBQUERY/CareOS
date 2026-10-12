"use client";

import { useEffect, useRef, useState } from "react";
import { Microphone, MicrophoneSlash } from "@phosphor-icons/react";
import { usePersonalPreferences } from "./appearance";

// Spracheingabe nur mit Erkennung auf dem Gerät (Entscheidung vom 30.09.2026): Der Knopf erscheint nur, wenn der
// Browser die Erkennung lokal anbietet (Web Speech API mit `processLocally`); die Aufnahme verlässt das Gerät nicht.
// Ohne lokale Erkennung gibt es keine Spracheingabe – kein Rückgriff auf die Cloud-Erkennung des Browsers.
// Eingeschaltet in den persönlichen Einstellungen; erst dann fragt CareOS den Browser (manche Chromium-Builds ohne
// Sprachmodul beenden die Seite bei dieser Abfrage).

type Availability = "available" | "downloadable" | "downloading" | "unavailable";
type LocalOptions = { langs: string[]; processLocally: boolean };
type RecognitionResultEvent = Event & {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};
type LocalRecognition = EventTarget & {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: Event & { error: string }) => void) | null;
};
type LocalRecognitionClass = {
  new (): LocalRecognition;
  available?: (options: LocalOptions) => Promise<Availability>;
  install?: (options: LocalOptions) => Promise<boolean>;
};

const LANGUAGES = ["de-CH", "de-DE"];

function recognitionClass(): LocalRecognitionClass | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as { SpeechRecognition?: LocalRecognitionClass };
  const candidate = scope.SpeechRecognition;
  // Ohne Abfrage der lokalen Verfügbarkeit lässt sich nicht sicherstellen, dass nichts das Gerät verlässt.
  return candidate && typeof candidate.available === "function" ? candidate : null;
}

// Erste deutsche Sprache, die auf dem Gerät erkannt werden kann (oder sich laden lässt).
async function localLanguage(Recognition: LocalRecognitionClass) {
  for (const lang of LANGUAGES) {
    const state = await Recognition.available!({ langs: [lang], processLocally: true }).catch(
      (): Availability => "unavailable",
    );
    if (state !== "unavailable") return { lang, state };
  }
  return null;
}

export function DictationButton({ onText }: { onText: (text: string) => void }) {
  const [support, setSupport] = useState<{ lang: string; state: Availability } | null>(null);
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState("");
  const recognition = useRef<LocalRecognition | null>(null);
  const enabled = usePersonalPreferences()?.dictation ?? false;
  const handler = useRef(onText);
  useEffect(() => {
    handler.current = onText;
  });

  useEffect(() => {
    const Recognition = enabled ? recognitionClass() : null;
    if (!Recognition) return;
    let live = true;
    void localLanguage(Recognition).then((found) => live && setSupport(found));
    return () => {
      live = false;
      recognition.current?.stop();
    };
  }, [enabled]);

  if (!enabled || !support) return null;

  const start = async () => {
    const Recognition = recognitionClass();
    if (!Recognition) return;
    setMessage("");
    if (support.state !== "available") {
      setMessage("Sprachpaket wird auf das Gerät geladen …");
      const installed = await Recognition.install?.({ langs: [support.lang], processLocally: true }).catch(() => false);
      if (!installed) {
        setMessage("Das Sprachpaket konnte nicht geladen werden.");
        return;
      }
      setSupport({ ...support, state: "available" });
      setMessage("");
    }
    const session = new Recognition();
    session.lang = support.lang;
    session.processLocally = true;
    session.continuous = true;
    session.interimResults = false;
    session.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal && result[0]?.transcript.trim()) handler.current(result[0].transcript.trim());
      }
    };
    session.onerror = (event) =>
      setMessage(
        event.error === "not-allowed" ? "Kein Zugriff auf das Mikrofon." : "Die Spracheingabe wurde unterbrochen.",
      );
    session.onend = () => setListening(false);
    recognition.current = session;
    session.start();
    setListening(true);
  };

  return (
    <span className="dictation">
      <button
        className="quiet-button dictation-button"
        type="button"
        aria-pressed={listening}
        onClick={() => (listening ? recognition.current?.stop() : void start())}
      >
        {listening ? <MicrophoneSlash aria-hidden="true" /> : <Microphone aria-hidden="true" />}
        {listening ? "Diktat beenden" : "Diktieren"}
      </button>
      <small>{message || (listening ? "Erkennung auf diesem Gerät – nichts wird übertragen" : "")}</small>
    </span>
  );
}

// Diktierten Text an den vorhandenen anhängen (mit Leerzeichen, erster Buchstabe gross).
export const appendDictation = (current: string, text: string) => {
  const sentence = text.charAt(0).toLocaleUpperCase("de-CH") + text.slice(1);
  return current.trim() ? `${current.replace(/\s+$/, "")} ${sentence}` : sentence;
};
