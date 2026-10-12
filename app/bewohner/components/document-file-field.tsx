"use client";

import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import { FileArrowUp, FileImage, FilePdf, FileText, X } from "@phosphor-icons/react";
import { RESIDENT_FILE_MAX_BYTES, RESIDENT_FILE_TYPES } from "@/lib/resident-record-shared";
import { fileSizeLabel } from "@/lib/documents-shared";

// Art der Datei für die Anzeige nach der Auswahl.
function fileKind(file: File) {
  if (file.type.startsWith("image/")) return "Bild";
  if (file.type === "application/pdf") return "PDF";
  return file.name.includes(".") ? (file.name.split(".").pop() ?? "").toUpperCase() : "Datei";
}

// Datei auswählen, per Klick oder durch Hineinziehen (eigene Oberfläche statt der Auswahl des Browsers).
// Standard: Dokument der Bewohnerakte, PDF oder Bild (z. B. ein fotografierter Arztbericht). Nach der Auswahl
// erscheinen Name, Art und Grösse, bei Bildern eine kleine Vorschau.
export default function DocumentFileField({
  file,
  onChange,
  onError,
  label = "Dokument",
  types = RESIDENT_FILE_TYPES,
  prompt = "PDF oder Bild auswählen",
  hint = "oder hierher ziehen · PDF, JPG, PNG, WebP · höchstens 4 MB",
  typeError = "Bitte ein PDF oder ein Bild (JPG, PNG, WebP) auswählen.",
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  onError: (message: string) => void;
  label?: string;
  types?: readonly string[];
  prompt?: string;
  hint?: string;
  typeError?: string;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const isImage = !!file && file.type.startsWith("image/");
  const preview = useMemo(() => (file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  const pick = (next: File | null | undefined) => {
    if (!next) return;
    if (!types.includes(next.type)) {
      onError(typeError);
      return;
    }
    if (next.size > RESIDENT_FILE_MAX_BYTES) {
      onError("Die Datei ist grösser als 4 MB.");
      return;
    }
    onError("");
    onChange(next);
  };
  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    pick(event.dataTransfer.files?.[0]);
  };
  const dragProps = {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: drop,
  };

  return (
    <div className="area-editor-wide document-file-field">
      <span className="document-file-label" id={`${inputId}-label`}>
        {label}
      </span>
      <input
        ref={input}
        id={inputId}
        className="document-file-input"
        type="file"
        accept={types.join(",")}
        aria-labelledby={`${inputId}-label`}
        onChange={(event) => {
          pick(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {file ? (
        <div className={`document-file-selected ${dragging ? "dragging" : ""}`} {...dragProps}>
          <span
            className={`document-file-thumb ${file.type === "application/pdf" ? "pdf" : "image"}`}
            style={preview ? { backgroundImage: `url(${preview})` } : undefined}
            aria-hidden="true"
          >
            {!preview && (isImage ? <FileImage /> : file.type === "application/pdf" ? <FilePdf /> : <FileText />)}
          </span>
          <span className="document-file-meta">
            <strong title={file.name}>{file.name}</strong>
            <small>
              {fileKind(file)} · {fileSizeLabel(file.size)}
            </small>
          </span>
          <button type="button" className="document-file-change" onClick={() => input.current?.click()}>
            Andere Datei
          </button>
          <button
            type="button"
            className="document-file-remove"
            aria-label="Datei entfernen"
            onClick={() => onChange(null)}
          >
            <X />
          </button>
        </div>
      ) : (
        <label htmlFor={inputId} className={`document-file-drop ${dragging ? "dragging" : ""}`} {...dragProps}>
          <span className="document-file-drop-icon">
            <FileArrowUp />
          </span>
          <strong>{prompt}</strong>
          <small>{hint}</small>
        </label>
      )}
    </div>
  );
}
