import { Fragment, type ReactNode } from 'react'

/**
 * Kleiner, sicherer Markdown-Renderer für Dokumente und Schulungstexte.
 * Unterstützt: Überschriften (#, ##, ###), Absätze, Listen (- / *), nummerierte Listen (1.),
 * Zitate (>), Codeblöcke (```), fett (**…**), kursiv (_…_) und Inline-Code (`…`).
 * Alles andere wird als Text ausgegeben. Es wird nie rohes HTML erzeugt: React escaped jeden Text.
 */

type Block =
  | { k: 'h'; level: 1 | 2 | 3; text: string }
  | { k: 'p'; text: string }
  | { k: 'ul' | 'ol'; items: string[]; start?: number }
  | { k: 'quote'; lines: string[] }
  | { k: 'code'; text: string }

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push({ k: 'p', text: para.join(' ') })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trimEnd()
    if (/^\s*```/.test(line)) {
      flush()
      const code: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++])
      out.push({ k: 'code', text: code.join('\n') })
      continue
    }
    if (!line.trim()) { flush(); continue }
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) { flush(); out.push({ k: 'h', level: h[1].length as 1 | 2 | 3, text: h[2] }); continue }
    if (/^\s*>/.test(line)) {
      flush()
      const q: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''))
      i--
      out.push({ k: 'quote', lines: q })
      continue
    }
    const ul = /^\s*[-*]\s+(.*)$/.exec(line)
    const ol = /^\s*(\d+)[.)]\s+(.*)$/.exec(line)
    if (ul || ol) {
      flush()
      const kind = ul ? 'ul' : 'ol'
      const re = kind === 'ul' ? /^\s*[-*]\s+(.*)$/ : /^\s*\d+[.)]\s+(.*)$/
      const items: string[] = []
      while (i < lines.length) {
        const m = re.exec(lines[i])
        if (m) items.push(m[1])
        else if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) items[items.length - 1] += ' ' + lines[i].trim()
        else break
        i++
      }
      i--
      out.push(kind === 'ul' ? { k: 'ul', items } : { k: 'ol', items, start: Number(ol![1]) })
      continue
    }
    para.push(line.trim())
  }
  flush()
  return out
}

/** Inline: `code`, **fett**, _kursiv_. */
export function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\b_[^_]+_\b)/g
  let last = 0
  let m: RegExpExecArray | null
  let n = 0
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const tok = m[0]
    if (m[1]) nodes.push(<code key={n++}>{tok.slice(1, -1)}</code>)
    else if (m[2]) nodes.push(<strong key={n++}>{inline(tok.slice(2, -2))}</strong>)
    else nodes.push(<em key={n++}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export function Markdown({ source, className = 'prose' }: { source: string; className?: string }) {
  const blocks = parseBlocks(source)
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        switch (b.k) {
          case 'h': {
            const H = b.level === 3 ? 'h3' : 'h2'
            return <H key={i}>{inline(b.text)}</H>
          }
          case 'p': return <p key={i}>{inline(b.text)}</p>
          case 'ul': return <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>
          case 'ol': return <ol key={i} start={b.start && b.start !== 1 ? b.start : undefined}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>
          case 'quote': return <blockquote key={i}>{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</blockquote>
          case 'code': return <pre key={i}><code>{b.text}</code></pre>
        }
      })}
    </div>
  )
}

/** Klartext ohne Markdown-Zeichen, z. B. für Suchtreffer-Ausschnitte. */
export function plainText(src: string) {
  return src.replace(/```[\s\S]*?```/g, ' ').replace(/^#{1,3}\s+/gm, '').replace(/^\s*([-*]|\d+[.)]|>)\s+/gm, '').replace(/\*\*|`|\b_|_\b/g, '').replace(/\s+/g, ' ').trim()
}
