// Bild einer betreuten Person (Browser): Datei prüfen, auf höchstens 640 px verkleinern und als JPEG (höchstens 1 MB)
// in eine Daten-URL umwandeln. Gemeinsam für die Aufnahme und die Akte.

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const PHOTO_ACCEPT = ACCEPTED.join(",");

export async function preparePhoto(file: File) {
  if (!ACCEPTED.includes(file.type)) throw new Error("Bitte ein JPEG-, PNG-, WebP- oder HEIC-Bild auswählen.");
  if (file.size > 15 * 1024 * 1024) throw new Error("Das ausgewählte Bild darf höchstens 15 MB gross sein.");
  // Nicht lesbare Dateien (z. B. beschädigt oder vom Browser nicht unterstützt) mit verständlicher Meldung.
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Das Bild konnte nicht gelesen werden. Bitte ein anderes Bild wählen.");
  });
  const maxSide = 640;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Bild konnte nicht verarbeitet werden.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
  if (!blob) throw new Error("Bild konnte nicht verarbeitet werden.");
  if (blob.size > 1024 * 1024)
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.68));
  if (!blob || blob.size > 1024 * 1024) throw new Error("Das Bild konnte nicht auf höchstens 1 MB verkleinert werden.");
  const result = blob;
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Bild konnte nicht gelesen werden."));
    reader.onerror = () => reject(new Error("Bild konnte nicht gelesen werden."));
    reader.readAsDataURL(result);
  });
}
