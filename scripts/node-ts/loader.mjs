import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("../../", import.meta.url);
const EXTENSIONS = [".ts", ".tsx", "/index.ts"];

function withExtension(url) {
  const path = fileURLToPath(url);
  if (existsSync(path) && !path.endsWith("/")) return url;
  for (const extension of EXTENSIONS) if (existsSync(path + extension)) return pathToFileURL(path + extension).href;
  return url;
}

export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
  if (specifier.startsWith("@/"))
    return { url: withExtension(new URL(specifier.slice(2), root).href), shortCircuit: true };
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const url = new URL(specifier, context.parentURL);
    if (!/\.[cm]?[jt]sx?$|\.json$/.test(url.pathname)) return { url: withExtension(url.href), shortCircuit: true };
  }
  // Next's subpath entry points ("next/headers") are CommonJS files without an exports map entry.
  if (/^next\/[a-z-]+$/.test(specifier)) return next(`${specifier}.js`, context);
  return next(specifier, context);
}
