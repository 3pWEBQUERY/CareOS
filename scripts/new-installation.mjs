// Geheimnisse für eine neue Kundeninstallation erzeugen (lokal, nichts wird gespeichert oder gesendet).
// Aufruf: node scripts/new-installation.mjs --kontakt=support@eure-firma.ch --land=CH "Alterszentrum Sonnengarten"
// Ausgabe: Variablen zum Einfügen in Railway › Dienst `carecore` › Variables › Raw Editor.
import { randomBytes } from "node:crypto";
import webpush from "web-push";

const args = process.argv.slice(2);
const contact =
  args
    .find((arg) => arg.startsWith("--kontakt="))
    ?.slice("--kontakt=".length)
    .trim() ?? "";
// Land der Einrichtung: CH (Schweiz), DE (Deutschland) oder AT (Österreich).
const country = (
  args
    .find((arg) => arg.startsWith("--land="))
    ?.slice("--land=".length)
    .trim() ?? ""
).toUpperCase();
const name = args
  .filter((arg) => !arg.startsWith("--"))
  .join(" ")
  .trim();
if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) || !["CH", "DE", "AT"].includes(country)) {
  console.error(
    'Aufruf: node scripts/new-installation.mjs --kontakt=support@eure-firma.ch --land=CH "Alterszentrum Sonnengarten"\n' +
      "--kontakt ist die Support-Adresse für Web Push (VAPID_SUBJECT), --land CH, DE oder AT.",
  );
  process.exit(1);
}

// Gut lesbares Startpasswort (ohne leicht verwechselbare Zeichen), 20 Zeichen.
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const password = Array.from(randomBytes(20), (byte) => alphabet[byte % alphabet.length]).join("");
const vapid = webpush.generateVAPIDKeys();

const lines = [
  `CARECORE_ORGANIZATION_NAME=${JSON.stringify(name)}`,
  `CARECORE_COUNTRY=${country}`,
  `CARECORE_ADMIN_PASSWORD=${password}`,
  `CARECORE_MFA_KEY=${randomBytes(32).toString("base64")}`,
  `CRON_SECRET=${randomBytes(32).toString("hex")}`,
  `VAPID_PUBLIC_KEY=${vapid.publicKey}`,
  `VAPID_PRIVATE_KEY=${vapid.privateKey}`,
  `VAPID_SUBJECT=mailto:${contact}`,
];

console.log(lines.join("\n"));
console.error(
  "\nNur in Railway einfügen, nicht speichern oder per E-Mail versenden." +
    "\nDatenbank, Bucket und Mistral/SMTP-Variablen siehe docs/INSTALLATION.md.",
);
