import { test } from "node:test";
import assert from "node:assert/strict";
import { createZip, readZip } from "@/lib/zip";
import { cleanModel, newSlide, type DeckModel } from "@/lib/office/model";
import { buildPptx, readPptx } from "@/lib/office/pptx";

const meta = { title: "Test", author: "Pflege Team" };
const foreign = (bytes: Buffer) => {
  const files = readZip(bytes);
  files.delete("carecore/model.json");
  return { files, bytes: createZip([...files].map(([path, content]) => ({ path, content }))) };
};

test("PowerPoint: Folienübergänge mit Tempo werden geschrieben und gelesen", () => {
  const model: DeckModel = {
    kind: "deck",
    theme: "carecore",
    slides: [
      { ...newSlide("title", "Hygiene"), transition: { type: "fade", speed: "slow" } },
      { ...newSlide("content", "Händedesinfektion"), transition: { type: "push", speed: "fast" } },
      newSlide("content", "Ohne Übergang"),
      { ...newSlide("section", "Fragen"), transition: { type: "cover", speed: "med" } },
    ],
  };
  const bytes = buildPptx(model, meta);
  const files = readZip(bytes);
  const slide = (n: number) => files.get(`ppt/slides/slide${n}.xml`)!.toString();
  assert.match(slide(1), /<p:transition spd="slow"><p:fade\/><\/p:transition><\/p:sld>$/);
  assert.match(slide(2), /<p:transition spd="fast"><p:push dir="l"\/><\/p:transition>/);
  assert.doesNotMatch(slide(3), /transition/);
  assert.match(slide(4), /<p:cover dir="l"\/>/);
  assert.deepEqual(readPptx(bytes).model, cleanModel("deck", model));

  // Aus PowerPoint gelesen (ohne gespeichertes Modell).
  const imported = readPptx(foreign(bytes).bytes).model;
  assert.deepEqual(
    imported.slides.map((item) => item.transition ?? null),
    [{ type: "fade", speed: "slow" }, { type: "push", speed: "fast" }, null, { type: "cover", speed: "med" }],
  );
});

test("PowerPoint: neuere Effekte nutzen den Ersatz für ältere Versionen, unbekannte entfallen", () => {
  const model: DeckModel = {
    kind: "deck",
    theme: "carecore",
    slides: [newSlide("title", "A"), newSlide("content", "B")],
  };
  const { files } = foreign(buildPptx(model, meta));
  const alternate =
    '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="p14"><p:transition spd="slow" p14:dur="2000"><p14:vortex dir="r"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow"><p:wipe/></p:transition></mc:Fallback></mc:AlternateContent>';
  const patch = (n: number, xml: string) =>
    files.set(
      `ppt/slides/slide${n}.xml`,
      Buffer.from(files.get(`ppt/slides/slide${n}.xml`)!.toString().replace("</p:sld>", `${xml}</p:sld>`)),
    );
  patch(1, alternate);
  patch(2, '<p:transition><p:randomBar dir="vert"/></p:transition>');
  const imported = readPptx(createZip([...files].map(([path, content]) => ({ path, content })))).model;
  assert.deepEqual(imported.slides[0].transition, { type: "wipe", speed: "slow" });
  assert.equal(imported.slides[1].transition, undefined);
  // Ungültige Angaben im Modell werden verworfen, fehlendes Tempo ist „mittel“.
  const cleaned = cleanModel("deck", {
    ...model,
    slides: [
      { ...model.slides[0], transition: { type: "explode" } },
      { ...model.slides[1], transition: { type: "fade", speed: "turbo" } },
    ],
  }) as DeckModel;
  assert.equal(cleaned.slides[0].transition, undefined);
  assert.deepEqual(cleaned.slides[1].transition, { type: "fade", speed: "med" });
});
