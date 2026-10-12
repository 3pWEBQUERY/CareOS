import { test } from "node:test";
import assert from "node:assert/strict";
import { mayReadFile } from "../lib/file-access-rules.ts";

const nurse = { id: "nurse", permissions: ["residents.read", "documentation.write"] };
const lead = { id: "lead", permissions: ["residents.read", "team.manage"] };
const guest = { id: "guest", permissions: [] };
const file = (purpose: string, extra: Partial<Parameters<typeof mayReadFile>[0]> = {}) => ({
  purpose,
  uploadedBy: "someone",
  documentId: null,
  certificateUserId: null,
  ...extra,
});

test("personal files are only readable by their uploader", () => {
  assert.equal(mayReadFile(file("cloud"), nurse), false);
  assert.equal(mayReadFile(file("cloud"), lead), false);
  assert.equal(mayReadFile(file("cloud", { uploadedBy: "nurse" }), nurse), true);
});

test("shared house files are readable by all staff", () => {
  assert.equal(mayReadFile(file("shared"), nurse), true);
  assert.equal(mayReadFile(file("shared", { uploadedBy: null }), guest), true);
});

test("chat files are readable by members of the conversation only", () => {
  assert.equal(mayReadFile(file("chat", { chatMember: true }), nurse), true);
  assert.equal(mayReadFile(file("chat", { chatMember: false }), lead), false);
  assert.equal(mayReadFile(file("chat", { uploadedBy: "nurse" }), nurse), false);
});

test("documents need the right to read resident records", () => {
  const document = file("document", { documentId: "doc" });
  assert.equal(mayReadFile(document, nurse), true);
  assert.equal(mayReadFile(document, guest), false);
  // A document file without document entry is treated like a personal file.
  assert.equal(mayReadFile(file("document"), nurse), false);
});

test("certificates: owner, uploader and team leads", () => {
  const certificate = file("certificate", { certificateUserId: "nurse" });
  assert.equal(mayReadFile(certificate, nurse), true);
  assert.equal(mayReadFile(certificate, lead), true);
  assert.equal(mayReadFile(certificate, guest), false);
  assert.equal(mayReadFile(file("certificate", { uploadedBy: "guest" }), guest), true);
});

test("unknown purposes are private", () => {
  assert.equal(mayReadFile(file("other"), lead), false);
});
