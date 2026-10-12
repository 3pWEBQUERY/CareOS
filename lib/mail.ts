import nodemailer from "nodemailer";

// E-Mail-Versand über SMTP: jeder Anbieter funktioniert (z. B. Brevo, Infomaniak oder der Mailserver der Einrichtung).
// Eingeschaltet, wenn SMTP_HOST, MAIL_FROM und die Adresse der App (APP_URL oder die Railway-Domain) gesetzt sind.
// Links in E-Mails bauen nie auf dem Host der Anfrage auf, damit niemand fremde Adressen unterschieben kann.

export function appBaseUrl(): string | null {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  return railway ? `https://${railway}` : null;
}

export function mailConfigured() {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.MAIL_FROM?.trim() && appBaseUrl());
}

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

function smtp() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    const user = process.env.SMTP_USER?.trim();
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST?.trim(),
      port,
      // Port 465 verschlüsselt von Anfang an; sonst STARTTLS, sobald der Server es anbietet.
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
      auth: user ? { user, pass: process.env.SMTP_PASSWORD ?? "" } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }
  return transport;
}

export type MailMessage = { to: string; subject: string; text: string; html: string };

export async function sendMail(message: MailMessage) {
  if (!mailConfigured()) throw new Error("MAIL_NOT_CONFIGURED");
  await smtp().sendMail({ from: process.env.MAIL_FROM?.trim(), ...message });
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

// Einheitliche, schlichte E-Mail mit einem Knopf; der Link steht zusätzlich als Text darunter.
export function linkMail(input: { heading: string; intro: string; action: string; url: string; note: string }) {
  const text = `${input.heading}\n\n${input.intro}\n\n${input.action}: ${input.url}\n\n${input.note}\n\nCareOS`;
  const html = `<!doctype html><html lang="de"><body style="margin:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#132940">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #d6e4f7;border-radius:12px">
<tr><td style="padding:28px 32px 8px;font-size:12px;font-weight:700;letter-spacing:.08em;color:#174a8f">CARECORE</td></tr>
<tr><td style="padding:0 32px;font-size:22px;font-weight:700">${escapeHtml(input.heading)}</td></tr>
<tr><td style="padding:14px 32px 0;font-size:14px;line-height:1.55;color:#40566e">${escapeHtml(input.intro)}</td></tr>
<tr><td style="padding:24px 32px"><a href="${escapeHtml(input.url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#2563eb;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none">${escapeHtml(input.action)}</a></td></tr>
<tr><td style="padding:0 32px 8px;font-size:12px;line-height:1.5;color:#60748c">${escapeHtml(input.note)}</td></tr>
<tr><td style="padding:0 32px 28px;font-size:11px;line-height:1.5;color:#8496aa;word-break:break-all">${escapeHtml(input.url)}</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}
