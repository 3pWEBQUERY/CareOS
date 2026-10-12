// Kleines XML-Werkzeug für Office-Dateien: Text sicher maskieren und Office-XML (ohne DTD) in einen Baum lesen.
export type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };

export const esc = (value: string) =>
  value
    // In XML 1.0 verbotene Steuerzeichen entfernen (sonst lässt sich die Datei nicht öffnen).
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (value: string) =>
  value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code: string) => {
    if (code[0] === "#")
      return String.fromCodePoint(code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    return ENTITIES[code] ?? match;
  });

// Namensraum-Präfix weglassen: „w:p“ → „p“ (Office verwendet feste Präfixe, für das Lesen genügt der lokale Name).
const local = (name: string) => name.slice(name.indexOf(":") + 1);

export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const pattern =
    /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const match of source.matchAll(pattern)) {
    const top = stack[stack.length - 1];
    if (match[1] !== undefined) top.text += match[1];
    else if (match[6] !== undefined) top.text += decode(match[6]);
    else if (match[3]) {
      if (match[2]) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const attrs: Record<string, string> = {};
      for (const attr of match[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
        attrs[local(attr[1])] = decode(attr[2] ?? attr[3] ?? "");
      const node: XmlNode = { name: local(match[3]), attrs, children: [], text: "" };
      top.children.push(node);
      if (!match[5]) stack.push(node);
    }
  }
  return root;
}

export const child = (node: XmlNode | undefined, name: string) => node?.children.find((item) => item.name === name);
export const childrenOf = (node: XmlNode | undefined, name: string) =>
  node?.children.filter((item) => item.name === name) ?? [];

export function find(node: XmlNode | undefined, name: string): XmlNode | undefined {
  if (!node) return undefined;
  for (const item of node.children) {
    if (item.name === name) return item;
    const found = find(item, name);
    if (found) return found;
  }
  return undefined;
}

export function findAll(node: XmlNode | undefined, name: string, out: XmlNode[] = []) {
  for (const item of node?.children ?? []) {
    if (item.name === name) out.push(item);
    else findAll(item, name, out);
  }
  return out;
}

// Gesamter Text eines Teilbaums (z. B. Zellinhalt mit mehreren Textläufen).
export const textOf = (node: XmlNode | undefined): string =>
  node ? node.text + node.children.map(textOf).join("") : "";
