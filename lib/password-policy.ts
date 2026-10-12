// Passwort-Richtlinie für Konten der Mitarbeitenden (nach NIST SP 800-63B: Länge und Sperrliste statt
// Zeichenklassen-Regeln). Die Mindestlänge legt die Einrichtung fest (Leitung › Konfiguration, ab 10 Zeichen).

export const MIN_PASSWORD_LENGTH = 10;

// Häufig verwendete und leicht zu erratende Passwörter ab 10 Zeichen (kleingeschrieben verglichen).
const COMMON_PASSWORDS = new Set([
  "1234567890",
  "0123456789",
  "0987654321",
  "9876543210",
  "1111111111",
  "1234512345",
  "12345678910",
  "123456789a",
  "a123456789",
  "1q2w3e4r5t",
  "1q2w3e4r5t6y",
  "q1w2e3r4t5",
  "qwertyuiop",
  "qwertzuiop",
  "asdfghjkl1",
  "asdfghjklö",
  "yxcvbnm123",
  "password12",
  "password123",
  "password1234",
  "passwort12",
  "passwort123",
  "passwort1234",
  "passwort!!",
  "kennwort123",
  "geheim1234",
  "hallo12345",
  "hallo123456",
  "willkommen",
  "willkommen1",
  "willkommen123",
  "welcome123",
  "iloveyou12",
  "letmein123",
  "admin12345",
  "administrator",
  "carecore123",
  "carecore2026",
  "pflege12345",
  "sommer2026",
  "winter2026",
  "fruehling2026",
  "herbst2026",
]);

export type PasswordContext = { minLength?: number | null; username?: string | null; displayName?: string | null };

// Fehlermeldung für ein neues Passwort oder null, wenn es die Richtlinie erfüllt.
export function passwordPolicyError(password: string, context: PasswordContext = {}): string | null {
  const minLength = Math.max(MIN_PASSWORD_LENGTH, context.minLength ?? MIN_PASSWORD_LENGTH);
  if (password.length < minLength) return `Das Passwort muss mindestens ${minLength} Zeichen lang sein.`;
  if (password.length > 200) return "Das Passwort ist zu lang (höchstens 200 Zeichen).";
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return "Dieses Passwort ist sehr verbreitet und leicht zu erraten.";
  if (new Set(lower).size < 4) return "Das Passwort braucht mindestens 4 verschiedene Zeichen.";
  const parts = [context.username, ...(context.displayName ?? "").split(/\s+/)]
    .map((part) => (part ?? "").trim().toLowerCase())
    .filter((part) => part.length >= 3);
  if (parts.some((part) => lower.includes(part)))
    return "Das Passwort darf den Benutzernamen oder den eigenen Namen nicht enthalten.";
  return null;
}
