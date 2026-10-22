/** Grenzen für Datei-Uploads – ohne Server-Abhängigkeiten, damit FileField vor dem Hochladen prüfen kann. */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
export const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic',
  'application/pdf',
  'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'video/mp4',
]
/** accept-Attribut für allgemeine Dokument-Uploads (entspricht ALLOWED_TYPES). */
export const ACCEPT_UPLOADS = ALLOWED_TYPES.join(',')
