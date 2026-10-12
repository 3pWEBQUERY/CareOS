// Lets plain Node (tests, seed scripts) load app modules: resolves "@/..." like tsconfig paths, adds the
// missing ".ts"/".tsx" extension and stubs Next's "server-only" marker.
import { register } from "node:module";

register("./loader.mjs", import.meta.url);
