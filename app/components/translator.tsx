"use client";

import { useEffect } from "react";
import { compileDictionary, translateText, type CompiledDictionary } from "@/lib/i18n-core";
import { isLanguage, type Dictionary, type Language } from "@/lib/i18n-shared";

// Sprache der Oberfläche: übersetzt angezeigte Texte (Textknoten und die Attribute placeholder, title, aria-label,
// alt) nach dem Wörterbuch der gewählten Sprache, ohne das Aussehen zu verändern. Übersetzt werden nur ganze Texte,
// die im Katalog stehen (locales/catalog.json); alles andere – insbesondere erfasste Inhalte – bleibt, wie es ist.
// Bereiche mit translate="no" bleiben unberührt. Unbekannte Texte erscheinen auf Deutsch.

export const LANGUAGE_KEY = "carecore-language";
// Nur Administration: ungeprüfte Entwürfe beim Prüfen im Zusammenhang anzeigen.
export const REVIEW_KEY = "carecore-language-review";
export const LANGUAGE_EVENT = "carecore:language";
const dictionaryKey = (locale: Language, review: boolean) => `carecore-dictionary-${locale}${review ? "-review" : ""}`;
const ATTRIBUTES = ["placeholder", "title", "aria-label", "alt"] as const;
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "CODE", "PRE"]);

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ohne Speicher gilt die Sprache erst nach dem Laden der Einstellungen
  }
}

// Administration prüft gerade eine Sprache in der App (Vorschau mit Entwürfen).
export const reviewing = () => read(REVIEW_KEY) === "1";

export const activeLanguage = (): Language => {
  const stored = read(LANGUAGE_KEY);
  return isLanguage(stored) ? stored : "de";
};

// Gewählte Sprache merken; eine andere Sprache gilt nach dem Neuladen der Seite (alle Texte frisch).
export function rememberLanguage(locale: Language, reload = true) {
  if (activeLanguage() === locale) return;
  write(LANGUAGE_KEY, locale === "de" ? null : locale);
  if (reload) window.location.reload();
}

const skipped = (element: Element | null) =>
  !!element && (SKIP.has(element.tagName) || !!element.closest("[translate='no'], [contenteditable='true']"));

// Stand je Knoten: Ausgangstext und zuletzt gesetzte Übersetzung (um eigene Änderungen zu erkennen).
const texts = new WeakMap<Text, { source: string; shown: string }>();
const attributes = new WeakMap<Element, Map<string, { source: string; shown: string }>>();

function translateNode(node: Text, dictionary: CompiledDictionary) {
  if (skipped(node.parentElement)) return;
  const current = node.data;
  const known = texts.get(node);
  const source = known && known.shown === current ? known.source : current;
  const translated = translateText(source, dictionary) ?? source;
  texts.set(node, { source, shown: translated });
  if (translated !== current) node.data = translated;
}

function translateAttributes(element: Element, dictionary: CompiledDictionary) {
  if (skipped(element)) return;
  for (const name of ATTRIBUTES) {
    const current = element.getAttribute(name);
    if (current === null) continue;
    const state = attributes.get(element) ?? new Map<string, { source: string; shown: string }>();
    const known = state.get(name);
    const source = known && known.shown === current ? known.source : current;
    const translated = translateText(source, dictionary) ?? source;
    state.set(name, { source, shown: translated });
    attributes.set(element, state);
    if (translated !== current) element.setAttribute(name, translated);
  }
}

function translateTree(root: Node, dictionary: CompiledDictionary) {
  if (root.nodeType === Node.TEXT_NODE) return translateNode(root as Text, dictionary);
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root as Element, dictionary);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if (node.nodeType === Node.TEXT_NODE) translateNode(node as Text, dictionary);
    else translateAttributes(node as Element, dictionary);
}

export default function Translator() {
  useEffect(() => {
    const onChange = (event: Event) => rememberLanguage((event as CustomEvent<Language>).detail);
    window.addEventListener(LANGUAGE_EVENT, onChange);
    const locale = activeLanguage();
    document.documentElement.lang = locale === "sr" ? "sr-Latn" : locale;
    if (locale === "de") {
      document.documentElement.classList.remove("i18n-pending");
      return () => window.removeEventListener(LANGUAGE_EVENT, onChange);
    }
    const review = reviewing();
    let dictionary: CompiledDictionary | null = null;
    const observer = new MutationObserver((mutations) => {
      if (!dictionary) return;
      for (const mutation of mutations)
        if (mutation.type === "characterData") translateNode(mutation.target as Text, dictionary);
        else if (mutation.type === "attributes") translateAttributes(mutation.target as Element, dictionary);
        else mutation.addedNodes.forEach((node) => translateTree(node, dictionary!));
    });
    const apply = (raw: Dictionary) => {
      dictionary = compileDictionary(raw);
      translateTree(document.documentElement, dictionary);
      document.documentElement.classList.remove("i18n-pending");
    };
    const cached = read(dictionaryKey(locale, review));
    if (cached)
      try {
        apply(JSON.parse(cached) as Dictionary);
      } catch {
        write(dictionaryKey(locale, review), null);
      }
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRIBUTES],
    });
    let live = true;
    fetch(`/api/i18n/${locale}${review ? "?drafts=1" : ""}`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 404) {
          // Sprache nicht (mehr) freigegeben: zurück zu Deutsch.
          write(dictionaryKey(locale, review), null);
          rememberLanguage("de");
          return;
        }
        if (!response.ok || !live) return;
        const raw = (await response.json()) as Dictionary;
        write(dictionaryKey(locale, review), JSON.stringify(raw));
        apply(raw);
      })
      .catch(() => undefined)
      .finally(() => document.documentElement.classList.remove("i18n-pending"));
    return () => {
      live = false;
      observer.disconnect();
      window.removeEventListener(LANGUAGE_EVENT, onChange);
    };
  }, []);
  return null;
}
