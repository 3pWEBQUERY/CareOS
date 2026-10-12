// Rebuild the compact body-surface assets from Human Atlas (CC BY 4.0).
// The source files and license are documented in public/body-surfaces/ATTRIBUTION.md.
import { writeFile, mkdir } from "node:fs/promises";

const base =
  "https://raw.githubusercontent.com/slorksmo/Human-Atlas/5bb5713aab18d7fe9380c3339eb09f173491ea06/public/models";
const outputDirectory = new URL("../public/body-surfaces/", import.meta.url);

async function download(path) {
  const response = await fetch(`${base}/${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

await mkdir(outputDirectory, { recursive: true });
for (const [sex, manifestName] of [
  ["male", "atlas.json"],
  ["female", "atlas-female.json"],
]) {
  const manifest = JSON.parse(new TextDecoder().decode(await download(manifestName)));
  const skin = manifest.parts.find((part) => part.name === "Skin" && part.system === "integumentary");
  if (!skin) throw new Error(`No skin surface for ${sex}`);
  const chunk = new Uint8Array(await download(manifest.chunks[skin.chunk].url.split("/").at(-1)));
  const positionBytes = skin.vertexCount * 3 * 4;
  const normalBytes = skin.vertexCount * 3 * 2;
  const indexBytes = skin.indexCount * 4;
  const result = new Uint8Array(8 + positionBytes + normalBytes + indexBytes);
  const header = new DataView(result.buffer);
  header.setUint32(0, skin.vertexCount, true);
  header.setUint32(4, skin.indexCount, true);
  result.set(chunk.subarray(skin.positions, skin.positions + positionBytes), 8);
  result.set(chunk.subarray(skin.normals, skin.normals + normalBytes), 8 + positionBytes);
  result.set(chunk.subarray(skin.indices, skin.indices + indexBytes), 8 + positionBytes + normalBytes);
  await writeFile(new URL(`${sex}.bin`, outputDirectory), result);
  console.log(`${sex}: ${skin.vertexCount} vertices, ${skin.indexCount / 3} triangles, ${result.byteLength} bytes`);
}
