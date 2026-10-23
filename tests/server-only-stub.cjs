// Integrationstests laufen ausserhalb von Next.js: «server-only» (Marker gegen Import im Browser) auf die leere
// Variante umleiten, damit Server-Module (src/lib/*) direkt gegen Postgres getestet werden können.
const Module = require('node:module')
const orig = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'server-only') return require('node:path').join(__dirname, '..', 'node_modules', 'server-only', 'empty.js')
  return orig.call(this, request, ...rest)
}
