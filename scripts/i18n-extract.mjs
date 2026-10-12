// Sammelt die Texte der Oberfläche (JSX-Text, Beschriftungen, Meldungen) aus app/ und lib/ in locales/catalog.json.
// Grundlage für die Übersetzungen: jeder Eintrag ist der deutsche Ausgangstext; Vorlagen mit Platzhaltern (`${…}` im
// Code) stehen als Muster mit {0}, {1} … darin. Aufruf: npm run i18n:extract (CI prüft, dass der Katalog aktuell ist).
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import ts from "typescript";

const files = execSync(
  "git ls-files --cached --others --exclude-standard 'app/**/*.tsx' 'app/**/*.ts' 'lib/**/*.ts' 'app/*.tsx'",
)
  .toString()
  .trim()
  .split("\n")
  .filter((file) => file && !/\.test\.|\.d\.ts$|\/api\/fhir\//.test(file));

// Attribute, deren Wert nie angezeigt wird.
const SKIP_ATTRIBUTES = new Set([
  "className",
  "key",
  "id",
  "href",
  "src",
  "type",
  "name",
  "role",
  "htmlFor",
  "autoComplete",
  "inputMode",
  "method",
  "target",
  "rel",
  "lang",
  "dir",
  "pattern",
  "accept",
  "form",
  "viewBox",
  "d",
  "fill",
  "stroke",
  "strokeWidth",
  "xmlns",
  "encType",
  "sizes",
  "as",
  "value",
  "defaultValue",
  "mode",
  "variant",
  "tone",
  "icon",
  "name",
  "weight",
  "activeModule",
  "activeChild",
  "pageClass",
  "view",
  "kind",
  "anchor",
]);
// Aufrufe, deren Texte nicht angezeigt werden.
const SKIP_CALLS =
  /^(console\.\w+|fetch|requestJson|send|import|require|sql|q|new URL|URL|querySelector\w*|getItem|setItem|removeItem|addEventListener|removeEventListener|dispatchEvent|postMessage|matchMedia|JSON\.parse|RegExp|Intl\.\w+|toLocale\w+|localeCompare|startsWith|endsWith|includes|split|replace|replaceAll|join|match|test|padStart|getElementById|closest|cookies\(\)\.\w+|headers\.get|searchParams\.\w+|NextResponse\.redirect|redirect|router\.\w+|useApiData|sendOrQueue|sessionStorage\.\w+|localStorage\.\w+|createElement|setAttribute|getAttribute|hasPermission|apiContext|assertUuid)$/;

const looksLikeText = (value) => {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length < 2 || !/\p{L}{2,}/u.test(text)) return false;
  if (/^(https?:|mailto:|\/|\.|#|@|data:)/.test(text)) return false;
  if (/^[a-z0-9]+([._:/-][a-z0-9]+)+$/i.test(text) && !/\s/.test(text)) return false; // Schlüssel, Pfade
  if (/^[a-z][a-zA-Z0-9]*$/.test(text)) return false; // Bezeichner in Kleinschreibung
  if (/^[A-Z0-9_]+$/.test(text)) return false; // KONSTANTEN
  if (/\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN)\b/.test(text)) return false; // SQL
  if (/[{}<>;=]|=>/.test(text)) return false; // Code
  if (/^[\w-]+(\s+[\w-]+)*$/.test(text) && /^[a-z]/.test(text) && !/[äöüÄÖÜ]/.test(text) && !/\s/.test(text))
    return false;
  // Deutscher Text: Grossbuchstabe am Wortanfang, Umlaut oder mehrere Wörter.
  return /(^|\s)[A-ZÄÖÜ][a-zäöüß]/.test(text) || /[äöüÄÖÜß]/.test(text) || /\p{L}+\s+\p{L}+/u.test(text);
};

const strings = new Set();
const patterns = new Set();

const callName = (node) => {
  const expression = node.expression;
  return expression ? expression.getText().replace(/\s+/g, "") : "";
};

function skipped(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
    if (ts.isTaggedTemplateExpression(parent)) return true;
    if (ts.isJsxAttribute(parent) && SKIP_ATTRIBUTES.has(parent.name.getText())) return true;
    if (ts.isJsxAttribute(parent) && /^data-/.test(parent.name.getText())) return true;
    if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && SKIP_CALLS.test(callName(parent))) return true;
    if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
    if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
    if (ts.isCaseClause(parent) && parent.expression === node) return true;
    if (ts.isBinaryExpression(parent) && /^(===|!==|==|!=)$/.test(parent.operatorToken.getText())) return true;
    if (ts.isTypeNode(parent) || ts.isLiteralTypeNode(parent)) return true;
    if (ts.isJsxExpression(parent) || ts.isJsxElement(parent) || ts.isBlock(parent) || ts.isSourceFile(parent)) break;
  }
  return false;
}

const normalize = (text) => text.replace(/\s+/g, " ").trim();

for (const file of files) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const text = normalize(node.getText());
      if (looksLikeText(text)) strings.add(text);
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !skipped(node)) {
      const text = normalize(node.text);
      if (looksLikeText(text)) strings.add(text);
    } else if (ts.isTemplateExpression(node) && !skipped(node)) {
      let pattern = node.head.text;
      node.templateSpans.forEach((span, index) => (pattern += `{${index}}${span.literal.text}`));
      pattern = normalize(pattern);
      const statics = pattern.replace(/\{\d+\}/g, " ");
      if (looksLikeText(statics) && /\p{L}{3,}/u.test(statics)) patterns.add(pattern);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const collator = new Intl.Collator("de-CH");
const catalog = {
  strings: [...strings].sort(collator.compare),
  patterns: [...patterns].filter((pattern) => !strings.has(pattern)).sort(collator.compare),
};
writeFileSync("locales/catalog.json", `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`${catalog.strings.length} Texte, ${catalog.patterns.length} Muster`);
