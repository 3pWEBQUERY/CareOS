import { LOGO_MAX_BYTES, LOGO_MAX_EDGE, LOGO_UPLOAD_MAX_BYTES } from "@/lib/branding-shared";

const TYPES = ["image/jpeg", "image/png", "image/webp"];

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Bild konnte nicht gelesen werden."));
    reader.readAsDataURL(blob);
  });

const encode = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

// Logo als Data-URL zum Hochladen: kleine Dateien unverändert, grössere verkleinert (Transparenz bleibt erhalten).
export async function logoDataUrl(file: File) {
  if (!TYPES.includes(file.type)) throw new Error("Erlaubt sind JPEG-, PNG- und WebP-Bilder.");
  if (file.size > LOGO_UPLOAD_MAX_BYTES)
    throw new Error(`Das Bild darf höchstens ${LOGO_UPLOAD_MAX_BYTES / 1024 / 1024} MB gross sein.`);
  if (file.size <= LOGO_MAX_BYTES) return toDataUrl(file);

  const image = await createImageBitmap(file).catch(() => {
    throw new Error("Bild konnte nicht gelesen werden.");
  });
  const scale = Math.min(1, LOGO_MAX_EDGE / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  // JPEG bleibt JPEG; PNG und WebP werden WebP (mit Transparenz), wo der Browser es nicht kann, PNG.
  const attempts: Array<[string, number | undefined]> =
    file.type === "image/jpeg"
      ? [
          ["image/jpeg", 0.9],
          ["image/jpeg", 0.75],
        ]
      : [
          ["image/webp", 0.92],
          ["image/png", undefined],
          ["image/webp", 0.75],
        ];
  for (const [type, quality] of attempts) {
    const blob = await encode(canvas, type, quality);
    if (blob && TYPES.includes(blob.type) && blob.size <= LOGO_MAX_BYTES) return toDataUrl(blob);
  }
  throw new Error("Das Bild lässt sich nicht genug verkleinern. Bitte ein kleineres Bild wählen.");
}
