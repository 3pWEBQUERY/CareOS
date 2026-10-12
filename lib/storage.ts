import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Ablage für Medien (Fotos, Dateien, Logo) in einem S3-kompatiblen Bucket, z. B. Railway Buckets. Eingerichtet über
// S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID und S3_SECRET_ACCESS_KEY (S3_FORCE_PATH_STYLE=true für
// Pfad-Adressen). Der Bucket ist privat; ausgeliefert wird immer über die Schnittstelle von CareOS mit den
// jeweiligen Rechten. Ohne Bucket (lokal, Tests) bleiben die Inhalte in der Datenbank.

let client: S3Client | null = null;

function config() {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) return null;
  return {
    bucket: S3_BUCKET,
    endpoint: S3_ENDPOINT,
    region: process.env.S3_REGION || "auto",
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  };
}

export const storageConfigured = () => config() !== null;

function s3() {
  const settings = config();
  if (!settings) throw new Error("STORAGE_NOT_CONFIGURED");
  client ??= new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: settings.forcePathStyle,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
  });
  return { client, bucket: settings.bucket };
}

// Schlüssel je Art und Einrichtung, z. B. „wound-photos/<org>/<id>“; keine Namen oder Inhalte im Schlüssel.
export const storageKey = (kind: string, organizationId: string, id: string) => `${kind}/${organizationId}/${id}`;

export async function putObject(key: string, body: Buffer, contentType: string) {
  const { client, bucket } = s3();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function getObject(key: string): Promise<Buffer | null> {
  const { client, bucket } = s3();
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return result.Body ? Buffer.from(await result.Body.transformToByteArray()) : null;
  } catch (error) {
    if ((error as { name?: string }).name === "NoSuchKey") return null;
    throw error;
  }
}

export async function deleteObject(key: string) {
  const { client, bucket } = s3();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

// Inhalt lesen: aus dem Bucket (Schlüssel) oder aus der Datenbank (Base64 bzw. Bytes).
export async function mediaContent(storageKey: unknown, stored: unknown): Promise<Buffer | null> {
  if (typeof storageKey === "string" && storageKey) return getObject(storageKey);
  if (typeof stored === "string") return Buffer.from(stored, "base64");
  if (stored instanceof Uint8Array) return Buffer.from(stored);
  return null;
}

// Entfernen (nach dem Löschen in der Datenbank); Fehler des Buckets verhindern das Löschen nicht, werden aber gemeldet.
export async function removeMedia(keys: unknown[]) {
  const list = keys.filter((key): key is string => typeof key === "string" && key.length > 0);
  if (!list.length || !storageConfigured()) return;
  await Promise.all(
    list.map((key) => deleteObject(key).catch((error) => console.error("Media delete failed", key, error))),
  );
}

// Speichern: mit Bucket dort (Rückgabe: Schlüssel), sonst null – dann gehört der Inhalt in die Datenbank.
export async function storeMedia(kind: string, organizationId: string, id: string, body: Buffer, contentType: string) {
  if (!storageConfigured()) return null;
  const key = storageKey(kind, organizationId, id);
  await putObject(key, body, contentType);
  return key;
}
