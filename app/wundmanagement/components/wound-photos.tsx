"use client";

import { useTerms } from "@/app/components/care-context";
import Image from "next/image";
import { useRef, useState, type ChangeEvent } from "react";
import { Camera, X } from "@phosphor-icons/react";
import { EditorDialog, ReasonDialog, formatDateTime, useApiData, type ShowToast } from "@/app/components/workspace-ui";
import type { WoundPhoto } from "@/lib/wound-photos";
import type { Wound } from "@/lib/wounds-shared";

// Re-encodes the photo as JPEG with at most 1600 px on the long side. This keeps uploads
// small and drops EXIF metadata such as the GPS position of the phone.
async function downscale(file: File, maxSide = 1600) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("Foto konnte nicht verarbeitet werden."))),
      "image/jpeg",
      0.85,
    ),
  );
  return { blob, width, height };
}

export default function WoundPhotos({
  wound,
  canWrite,
  showToast,
  onChanged,
}: {
  wound: Wound;
  canWrite: boolean;
  showToast: ShowToast;
  onChanged: () => void;
}) {
  const t = useTerms();
  const photos = useApiData<{ photos: WoundPhoto[] }>(`/api/wounds/${wound.id}/photos`);
  const [file, setFile] = useState<File | null>(null);
  const [viewing, setViewing] = useState<WoundPhoto | null>(null);
  const [hiding, setHiding] = useState<WoundPhoto | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = photos.data?.photos ?? [];
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null);
    event.target.value = "";
  };

  return (
    <div className="wound-photos">
      <div className="wound-photos-grid">
        {list.map((photo) => (
          <button
            type="button"
            key={photo.id}
            onClick={() => setViewing(photo)}
            aria-label={`Foto vom ${formatDateTime(photo.takenAt)} ansehen`}
          >
            <Image src={`/api/wounds/photos/${photo.id}`} alt="" fill sizes="96px" unoptimized />
            <small>{formatDateTime(photo.takenAt)}</small>
          </button>
        ))}
        {canWrite && wound.status !== "closed" && (
          <button type="button" className="wound-photo-add" onClick={() => input.current?.click()}>
            <Camera aria-hidden="true" />
            Foto hinzufügen
          </button>
        )}
      </div>
      {!photos.loading && !list.length && <p className="list-hint">Noch keine Fotos dokumentiert.</p>}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        capture="environment"
        hidden
        onChange={pick}
      />
      {file && (
        <PhotoUploadDialog
          wound={wound}
          file={file}
          onClose={() => setFile(null)}
          onSaved={() => {
            setFile(null);
            showToast(`${wound.residentName}: Foto gespeichert`);
            photos.reload();
            onChanged();
          }}
        />
      )}
      {viewing && (
        <div
          className="area-editor-overlay wound-photo-viewer"
          role="presentation"
          onMouseDown={(e) => e.target === e.currentTarget && setViewing(null)}
        >
          <section role="dialog" aria-modal="true" aria-label="Wundfoto">
            <header>
              <div>
                <strong>{wound.title}</strong>
                <small>
                  {formatDateTime(viewing.takenAt)} · {viewing.uploadedBy ?? "unbekannt"}
                  {viewing.caption ? ` · ${viewing.caption}` : ""}
                </small>
              </div>
              {canWrite && (
                <button className="secondary-button" type="button" onClick={() => setHiding(viewing)}>
                  Ausblenden
                </button>
              )}
              <button
                className="area-editor-close"
                type="button"
                aria-label="Foto schliessen"
                onClick={() => setViewing(null)}
              >
                <X />
              </button>
            </header>
            <div className="wound-photo-frame">
              <Image
                src={`/api/wounds/photos/${viewing.id}`}
                alt={`Wundfoto ${wound.bodyLocation}, ${formatDateTime(viewing.takenAt)}`}
                width={viewing.width ?? 1600}
                height={viewing.height ?? 1200}
                unoptimized
              />
            </div>
          </section>
        </div>
      )}
      {hiding && (
        <ReasonDialog
          eyebrow={`Wunden · ${wound.residentName}`}
          title="Foto ausblenden"
          description="Das Foto bleibt als Teil der Pflegedokumentation gespeichert, wird aber nicht mehr angezeigt."
          label="Grund"
          placeholder={`z. B. falscher ${t.one}, unscharf, versehentlich aufgenommen`}
          submitLabel="Ausblenden"
          danger
          onClose={() => setHiding(null)}
          onConfirm={async (reason) => {
            const response = await fetch(`/api/wounds/photos/${hiding.id}`, {
              method: "DELETE",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ reason }),
            });
            if (!response.ok)
              throw new Error(
                (await response.json().catch(() => null))?.error ?? "Foto konnte nicht ausgeblendet werden.",
              );
            setHiding(null);
            setViewing(null);
            showToast("Foto ausgeblendet");
            photos.reload();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function PhotoUploadDialog({
  wound,
  file,
  onClose,
  onSaved,
}: {
  wound: Wound;
  file: File;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTerms();
  const [caption, setCaption] = useState("");
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [preview] = useState(() => URL.createObjectURL(file));

  async function save() {
    if (!consent) {
      setError("Bitte die Einwilligung zur Fotodokumentation bestätigen.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { blob, width, height } = await downscale(file);
      const form = new FormData();
      form.set("file", blob, "wundfoto.jpg");
      form.set("caption", caption);
      form.set("consent", "true");
      form.set("width", String(width));
      form.set("height", String(height));
      if (file.lastModified) form.set("takenAt", new Date(Math.min(file.lastModified, Date.now())).toISOString());
      const response = await fetch(`/api/wounds/${wound.id}/photos`, { method: "POST", body: form });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Foto konnte nicht gespeichert werden.");
      URL.revokeObjectURL(preview);
      onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message !== "The source image could not be decoded."
          ? cause.message
          : "Das Foto konnte nicht gelesen werden. Bitte als JPEG oder PNG aufnehmen.",
      );
      setSaving(false);
    }
  }

  return (
    <EditorDialog
      id="wound-photo"
      eyebrow={`Wunden · ${wound.residentName}`}
      title="Foto dokumentieren"
      description={`${wound.title}. Das Foto wird verkleinert und ohne Standort- oder Gerätedaten gespeichert.`}
      onClose={() => {
        URL.revokeObjectURL(preview);
        onClose();
      }}
      onSubmit={save}
      saving={saving}
      error={error}
      submitLabel="Foto speichern"
    >
      <div className="area-editor-wide wound-photo-preview">
        <Image src={preview} alt="Vorschau des ausgewählten Fotos" width={1600} height={1200} unoptimized />
      </div>
      <label className="area-editor-wide">
        <span>Beschreibung (optional)</span>
        <input
          maxLength={240}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="z. B. nach Reinigung, mit Massband"
        />
      </label>
      <label className="form-checkbox area-editor-wide">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        Die Einwilligung des {t.oneGenitive} bzw. der Vertretung zur Fotodokumentation liegt vor.
      </label>
    </EditorDialog>
  );
}
