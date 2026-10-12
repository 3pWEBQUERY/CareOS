import { test } from "node:test";
import assert from "node:assert/strict";
import { mentionedMembers } from "@/lib/messenger-shared";

const members = [
  { user_id: "a", display_name: "Anna Müller" },
  { user_id: "b", display_name: "Anna Müller-Meier" },
  { user_id: "c", display_name: "Max Meier" },
];

test("Erwähnungen: vollständiger Name, Gross-/Kleinschreibung egal, längster Name zuerst", () => {
  assert.deepEqual(mentionedMembers("Kannst du @anna müller kurz anrufen?", members), ["a"]);
  assert.deepEqual(mentionedMembers("@Anna Müller-Meier bitte übernehmen", members), ["b"]);
  assert.deepEqual(mentionedMembers("@Max Meier und @Anna Müller, danke", members).sort(), ["a", "c"]);
});

test("Erwähnungen: nur echte Namensgrenzen, keine Treffer ohne @", () => {
  assert.deepEqual(mentionedMembers("Anna Müller ist heute da", members), []);
  assert.deepEqual(mentionedMembers("@Max Meierhofer kommt später", members), []);
  assert.deepEqual(mentionedMembers("@Max Meier.", members), ["c"]);
});

test("Erwähnungen: @alle erreicht die ganze Gruppe, aber nicht „@allesamt“ oder „E-Mail@alle“", async () => {
  const { mentionsEveryone } = await import("@/lib/messenger-shared");
  assert.equal(mentionsEveryone("@alle bitte Händedesinfektion auffüllen"), true);
  assert.equal(mentionsEveryone("Info an @Alle."), true);
  assert.equal(mentionsEveryone("@allesamt"), false);
  assert.equal(mentionsEveryone("team@alle.ch"), false);
});

test("Vorschau: Formatierung entfernt, Aufzählung in einer Zeile, gekürzt", async () => {
  const { plainPreview } = await import("@/lib/messenger-shared");
  assert.equal(
    plainPreview("Wer übernimmt **Zimmer 12**?\n- Körperpflege\n- _Mobilisation_"),
    "Wer übernimmt Zimmer 12? · Körperpflege · Mobilisation",
  );
  assert.equal(plainPreview("snake_case_name bleibt"), "snake_case_name bleibt");
  assert.equal(plainPreview("a".repeat(200), 10), "aaaaaaaaa…");
});
