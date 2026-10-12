// Kleiner SMTP-Server nur für Tests (DB- und Klicktests): nimmt jede Nachricht an und hält sie im Speicher.
// Abruf über HTTP auf demselben Port + 1: GET /messages (alle), DELETE /messages (leeren).
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";

// Quoted-Printable und weiche Zeilenumbrüche entfernen, damit Tests Links im Klartext finden.
const decodeBody = (raw) =>
  raw.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

/** @typedef {{ from: string; to: string[]; subject: string; body: string }} MockMail */

/**
 * @param {number} [port]
 * @param {number} [httpPort]
 * @returns {Promise<{ port: number; httpPort: number; messages: MockMail[]; close: () => Promise<unknown> }>}
 */
export function startMockSmtp(port = 0, httpPort) {
  /** @type {MockMail[]} */
  const messages = [];
  const smtp = createServer((socket) => {
    let buffer = "";
    let inData = false;
    let current = { from: "", to: [], data: "" };
    socket.write("220 mock-smtp ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          current.data = buffer.slice(0, end).replace(/^\.\./gm, ".");
          buffer = buffer.slice(end + 5);
          inData = false;
          const subject = /^Subject: (.*)$/im.exec(current.data)?.[1] ?? "";
          messages.push({ from: current.from, to: current.to, subject, body: decodeBody(current.data) });
          current = { from: "", to: [], data: "" };
          socket.write("250 OK queued\r\n");
          continue;
        }
        const newline = buffer.indexOf("\r\n");
        if (newline < 0) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);
        const command = line.slice(0, 4).toUpperCase();
        if (command === "EHLO" || command === "HELO") socket.write("250-mock-smtp\r\n250 8BITMIME\r\n");
        else if (command === "MAIL") {
          current.from = line.replace(/^MAIL FROM:\s*/i, "").replace(/[<>]/g, "");
          socket.write("250 OK\r\n");
        } else if (command === "RCPT") {
          current.to.push(line.replace(/^RCPT TO:\s*/i, "").replace(/[<>]/g, ""));
          socket.write("250 OK\r\n");
        } else if (command === "DATA") {
          inData = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (command === "QUIT") {
          socket.end("221 Bye\r\n");
          return;
        } else socket.write("250 OK\r\n");
      }
    });
    socket.on("error", () => undefined);
  });

  const http = createHttpServer((req, res) => {
    if (req.url === "/messages" && req.method === "DELETE") messages.length = 0;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(messages));
  });

  return new Promise((resolve) => {
    smtp.listen(port, "127.0.0.1", () => {
      const smtpPort = smtp.address().port;
      http.listen(httpPort ?? (port ? port + 1 : 0), "127.0.0.1", () =>
        resolve({
          port: smtpPort,
          httpPort: http.address().port,
          messages,
          close: () =>
            Promise.all([new Promise((d) => smtp.close(() => d())), new Promise((d) => http.close(() => d()))]),
        }),
      );
    });
  });
}

// Als eigener Prozess für die Klicktests: node tests/support/mock-smtp.mjs <port> (Abruf auf <port> + 1)
if (process.argv[1]?.endsWith("mock-smtp.mjs")) {
  const port = Number(process.argv[2] ?? 3297);
  startMockSmtp(port).then(({ port: smtpPort, httpPort }) =>
    console.log(`Test-SMTP auf ${smtpPort}, Nachrichten auf http://127.0.0.1:${httpPort}/messages`),
  );
}
