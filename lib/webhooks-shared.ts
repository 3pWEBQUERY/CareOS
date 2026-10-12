// Ereignisse, die ein Webhook abonnieren kann. Die Meldung nennt nur den Verweis auf die FHIR-Ressource.
export const WEBHOOK_EVENTS = {
  "Patient.created": "Person aufgenommen",
  "Patient.updated": "Personendaten geändert (Name, Geburtsdatum, Geschlecht, Status …)",
  "Observation.created": "Vitalwert erfasst",
} as const;

export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;
export const WEBHOOK_EVENT_KEYS = Object.keys(WEBHOOK_EVENTS) as WebhookEvent[];
export const WEBHOOKS_MAX = 10;

export type WebhookSummary = {
  id: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  createdAt: string;
  createdBy: string | null;
  lastDeliveryAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
  pending: number;
  failed: number;
};
