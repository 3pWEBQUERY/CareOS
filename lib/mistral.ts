import "server-only";
import { Mistral } from "@mistralai/mistralai";
import { MistralError as MistralApiError } from "@mistralai/mistralai/models/errors";

// Mistral für CareOS KI, Übersetzungsentwürfe und KI-Dienstplanung (offizielles SDK, ohne Telemetrie). Der
// Schlüssel bleibt serverseitig; Prompt-Inhalte werden nicht geloggt.

export const MISTRAL_DEFAULT_MODEL = "mistral-small-latest";
export const mistralModel = () => process.env.MISTRAL_MODEL?.trim() || MISTRAL_DEFAULT_MODEL;
export const mistralConfigured = () => Boolean(process.env.MISTRAL_API_KEY?.trim());

export class MistralError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let client: Mistral | null = null;
let clientKey = "";

function mistral() {
  const apiKey = process.env.MISTRAL_API_KEY?.trim() ?? "";
  if (!client || clientKey !== apiKey) {
    client = new Mistral({ apiKey, timeoutMs: 120_000 });
    clientKey = apiKey;
  }
  return client;
}

// Antworttext einer Auswahl (Text oder Textteile).
function textOf(content: unknown) {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((chunk) =>
        chunk && typeof chunk === "object" && (chunk as { type?: string }).type === "text"
          ? String((chunk as { text?: string }).text ?? "")
          : "",
      )
      .join("");
  return "";
}

// Eine Anfrage mit JSON-Antwort nach Schema; liefert den Antworttext (JSON), sonst MistralError.
export async function mistralJson(request: { system: string; user: string; schema: object; temperature?: number }) {
  if (!mistralConfigured()) throw new MistralError("MISTRAL_API_KEY fehlt.", 503);
  try {
    const response = await mistral().chat.complete({
      model: mistralModel(),
      temperature: request.temperature ?? 0.2,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
      responseFormat: {
        type: "json_schema",
        jsonSchema: { name: "antwort", schemaDefinition: request.schema as Record<string, unknown>, strict: true },
      },
    });
    const choice = response.choices?.[0];
    const text = textOf(choice?.message?.content).trim();
    if (choice?.finishReason === "error") throw new MistralError("Die KI hat die Anfrage abgelehnt.", 422);
    if (!text) throw new MistralError("Die KI hat keine Antwort geliefert.", 502);
    return text;
  } catch (error) {
    throw apiFailure(error);
  }
}

// Freier Text (CareOS KI). `truncated`, wenn die Antwort an der Längengrenze abgeschnitten wurde.
export async function mistralText(request: { system: string; user: string; maxOutputTokens?: number }) {
  if (!mistralConfigured()) throw new MistralError("MISTRAL_API_KEY fehlt.", 503);
  try {
    const response = await mistral().chat.complete({
      model: mistralModel(),
      temperature: 0.3,
      maxTokens: request.maxOutputTokens ?? 8192,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
    });
    const choice = response.choices?.[0];
    if (choice?.finishReason === "error")
      throw new MistralError("Die KI hat diese Anfrage abgelehnt. Bitte den Auftrag anders formulieren.", 422);
    return {
      text: textOf(choice?.message?.content).trim(),
      truncated: choice?.finishReason === "length" || choice?.finishReason === "model_length",
    };
  } catch (error) {
    throw apiFailure(error);
  }
}

function apiFailure(error: unknown) {
  if (error instanceof MistralError) return error;
  if (error instanceof MistralApiError) {
    console.error("Mistral API error", error.statusCode);
    if (error.statusCode === 401 || error.statusCode === 403)
      return new MistralError("Der MISTRAL_API_KEY ist ungültig.", 503);
    if (error.statusCode === 429)
      return new MistralError("Die KI ist gerade ausgelastet. Bitte in einer Minute erneut versuchen.", 429);
    return new MistralError("Die KI ist im Moment nicht erreichbar.", 502);
  }
  return error;
}
