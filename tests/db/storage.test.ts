import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// Medien im Bucket: ein kleiner S3-kompatibler Server (Pfad-Adressen) steht für Railway Buckets. Mit Bucket liegen
// Inhalte nur dort, die Datenbank hält den Schlüssel; Lesen und Löschen gehen über den Bucket.
const objects = new Map<string, Buffer>();
const server = createServer((request, response) => {
  const key = decodeURIComponent(new URL(request.url ?? "/", "http://s3.test").pathname);
  if (request.method === "PUT") {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      objects.set(key, Buffer.concat(chunks));
      response.writeHead(200, { ETag: '"etag"' }).end();
    });
    return;
  }
  if (request.method === "GET") {
    const body = objects.get(key);
    if (!body)
      return response
        .writeHead(404, { "content-type": "application/xml" })
        .end("<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>");
    return response.writeHead(200, { "content-length": body.length }).end(body);
  }
  if (request.method === "DELETE") {
    objects.delete(key);
    return response.writeHead(204).end();
  }
  response.writeHead(405).end();
});

test("Medien im Bucket: Datei und Wundfoto nur im Bucket, lesbar, beim Löschen entfernt", async (t) => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const port = (server.address() as AddressInfo).port;
  Object.assign(process.env, {
    S3_ENDPOINT: `http://127.0.0.1:${port}`,
    S3_BUCKET: "carecore-test",
    S3_REGION: "auto",
    S3_ACCESS_KEY_ID: "test",
    S3_SECRET_ACCESS_KEY: "test-secret",
    S3_FORCE_PATH_STYLE: "true",
  });
  const { storeFile } = await import("@/lib/files");
  const { readableFile } = await import("@/lib/file-access");
  const { storePhoto, readPhoto } = await import("@/lib/wound-photos");
  const { createWound } = await import("@/lib/wounds");
  const { removeMedia } = await import("@/lib/storage");
  const { apiContextFor, createResident, fixture, q } = await import("../support/db");

  const f = await fixture();
  const ctx = await apiContextFor(f, "leadA");
  const pdf = Buffer.from("%PDF-1.4\n% CareOS Test\n");
  const stored = await storeFile(ctx, new File([pdf], "Bericht.pdf", { type: "application/pdf" }), "document", [
    "application/pdf",
  ]);
  const [row] = await q<{ content_base64: string | null; storage_key: string }>(
    `SELECT content_base64, storage_key FROM carecore_cloud_files WHERE id = $1`,
    [stored.id],
  );
  assert.equal(row.content_base64, null, "nicht in der Datenbank");
  assert.equal(row.storage_key, `files/${f.org}/${stored.id}`, "Schlüssel ohne Namen");
  assert.deepEqual(objects.get(`/carecore-test/${row.storage_key}`), pdf);
  const read = await readableFile(
    { ...ctx.actor, permissions: ["residents.read", "documents.read"] } as never,
    stored.id,
  );
  assert.deepEqual(read?.content, pdf);

  const resident = await createResident(f);
  const woundId = await createWound(ctx, {
    residentId: resident,
    woundType: "Ulcus cruris",
    bodyLocation: "Unterarm links",
    discoveredOn: new Date().toISOString().slice(0, 10),
  });
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");
  const form = new FormData();
  form.set("consent", "true");
  form.set("file", new File([png], "foto.png", { type: "image/png" }));
  const photoId = await storePhoto(ctx, woundId, form);
  const [photo] = await q<{ content: Buffer | null; storage_key: string }>(
    `SELECT content, storage_key FROM carecore_wound_photos WHERE id = $1`,
    [photoId],
  );
  assert.equal(photo.content, null);
  assert.deepEqual((await readPhoto(ctx, photoId)).content, png);

  await removeMedia([photo.storage_key, row.storage_key]);
  assert.equal(objects.size, 0, "aus dem Bucket entfernt");
  await assert.rejects(readPhoto(ctx, photoId), /Foto nicht gefunden/);
});
