'use client'

import { useEffect } from 'react'
import { useT } from '@/i18n/client'
import { IconPlus } from '@/components/icons'
import { Checkbox, Combobox, DateField, NumberField, RadioGroup, SegmentedControl, Select, Switch, TextField, Textarea, TimeField } from '@/components/ui/fields'
import { StateGrid, type DsState } from './ds-shell'

const STATE_SEL = /:(hover|focus|focus-visible|focus-within|active)(?![\w-])/

/** Selektorliste an Kommas der obersten Ebene teilen (nicht in :is(…), :not(…)). */
function splitSelectors(s: string) {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

const mirrorSelector = (s: string) =>
  s.replace(/:hover(?![\w-])/g, '[data-ds-hover]')
    .replace(/:focus-visible(?![\w-])/g, '[data-ds-focus]')
    .replace(/:focus-within(?![\w-])/g, ':has([data-ds-focus])')
    .replace(/:focus(?![\w-])/g, '[data-ds-focus]')
    .replace(/:active(?![\w-])/g, '[data-ds-active]')

function mirrorRules(rules: CSSRuleList): string {
  let css = ''
  for (const r of Array.from(rules)) {
    if (r instanceof CSSStyleRule) {
      const sels = splitSelectors(r.selectorText).filter((s) => STATE_SEL.test(s)).map(mirrorSelector)
      if (sels.length) css += `${sels.join(', ')} { ${r.style.cssText} }\n`
    } else if (r instanceof CSSMediaRule) {
      const inner = mirrorRules(r.cssRules)
      if (inner) css += `@media ${r.conditionText} {\n${inner}}\n`
    } else if (r instanceof CSSSupportsRule) {
      const inner = mirrorRules(r.cssRules)
      if (inner) css += `@supports ${r.conditionText} {\n${inner}}\n`
    }
  }
  return css
}

/**
 * Erzeugt aus allen :hover-, :focus(-visible)- und :active-Regeln der geladenen Stylesheets gleichwertige Regeln
 * für `[data-ds-hover|focus|active]`, damit die Zustände statisch nebeneinander sichtbar sind – ohne die
 * Komponentenstile nachzubauen. Nur solange die Seite offen ist (Constructable Stylesheet, CSP-konform).
 */
export function StateMirror() {
  useEffect(() => {
    let css = ''
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        css += mirrorRules(sheet.cssRules)
      } catch {
        // fremde Stylesheets (z. B. Schriften) sind nicht lesbar
      }
    }
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    return () => { document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet) }
  }, [])
  return null
}

/** Statussprache (PRD §51): fünf Bedeutungen, jeweils als Tag, Hinweis und Kennzeichen am Personenkopf. */
export function StatusLanguage() {
  const t = useT()
  const rows = [
    { key: 'neutral', tag: '', alert: '', flag: '' },
    { key: 'success', tag: 'ok', alert: 'ok', flag: null },
    { key: 'attention', tag: 'warn', alert: 'warn', flag: 'warn' },
    { key: 'critical', tag: 'crit', alert: 'crit', flag: 'crit' },
    { key: 'info', tag: 'accent', alert: 'info', flag: 'info' },
  ] as const
  return (
    <div className="tablewrap">
      <table className="stable ds-status">
        <thead>
          <tr>
            <th scope="col">{t('design.status.meaning')}</th>
            <th scope="col">{t('design.status.tag')}</th>
            <th scope="col">{t('design.status.alert')}</th>
            <th scope="col">{t('design.status.flag')}</th>
            <th scope="col">{t('design.status.classes')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">
                {t('design.status.' + r.key)}
                <div className="small muted" style={{ fontWeight: 400 }}>{t('design.status.' + r.key + 'Hint')}</div>
              </th>
              <td><span className={'tag ' + r.tag}>{t('design.status.ex.' + r.key + 'Tag')}</span></td>
              <td><div className={'alert ' + r.alert}><span className="grow">{t('design.status.ex.' + r.key + 'Alert')}</span></div></td>
              <td>{r.flag == null ? <span className="muted">–</span> : <span className={'flag ' + r.flag}>{t('design.status.ex.' + r.key + 'Flag')}</span>}</td>
              <td className="mono small nowrap">{['.tag' + (r.tag ? '.' + r.tag : ''), '.alert' + (r.alert ? '.' + r.alert : ''), r.flag != null ? '.flag' + (r.flag ? '.' + r.flag : '') : null].filter(Boolean).join(' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Schaltflächen: alle Varianten in allen Zuständen. */
export function ButtonStates() {
  const t = useT()
  const variants = [
    { key: 'standard', cls: 'btn', label: t('common.save') },
    { key: 'primary', cls: 'btn primary', label: t('common.save') },
    { key: 'danger', cls: 'btn danger', label: t('design.buttons.delete') },
    { key: 'dangerSolid', cls: 'btn danger solid', label: t('design.buttons.delete') },
    { key: 'ghost', cls: 'btn ghost', label: t('common.cancel') },
    { key: 'link', cls: 'linkbtn', label: t('design.buttons.open') },
  ]
  const btn = (cls: string, label: string, s: DsState) =>
    s === 'error' || s === 'success' || (s === 'loading' && cls === 'linkbtn') ? null : (
      <button type="button" className={cls} disabled={s === 'disabled' || s === 'loading'} data-loading={s === 'loading' || undefined} aria-busy={s === 'loading' || undefined}>{label}</button>
    )
  return (
    <>
      <p className="small muted ds-note">{t('design.forced')} {t('design.naLegend')}</p>
      <div className="ds-grid">
        {variants.map((v) => (
          <StateGrid key={v.key} title={`${t('design.buttons.' + v.key)} · .${v.cls.replace(/ /g, '.')}`} target="button" render={(s) => btn(v.cls, v.label, s)} />
        ))}
        <StateGrid
          title={`${t('design.buttons.icon')} · .icon-btn`} target="button"
          render={(s) => (s === 'error' || s === 'success' || s === 'loading' ? null : (
            <button type="button" className="icon-btn" aria-label={t('design.buttons.add')} title={t('design.buttons.add')} disabled={s === 'disabled'} aria-expanded={s === 'active' || undefined}><IconPlus size={18} /></button>
          ))}
        />
      </div>
      <div className="card">
        <div className="card-head"><h3>{t('design.buttons.sizes')}</h3></div>
        <div className="card-body row">
          <button type="button" className="btn sm">{t('design.buttons.small')} · .sm</button>
          <button type="button" className="btn">{t('design.buttons.normal')}</button>
          <button type="button" className="btn lg primary">{t('design.buttons.large')} · .lg</button>
          <button type="button" className="btn block">{t('design.buttons.block')} · .block</button>
        </div>
      </div>
    </>
  )
}

/** Felder und Auswahlen: Zustandsraster mit den echten Feld-Komponenten. */
export function FieldStates() {
  const t = useT()
  const err = t('design.fields.errRequired')
  const units = [{ v: 'wg1', l: 'Wohngruppe 1' }, { v: 'wg2', l: 'Wohngruppe 2' }]
  const people = [
    { value: 'r1', label: 'Keller Rosa', hint: t('design.ex.room', { n: '12' }) },
    { value: 'r2', label: 'Brunner Hans', hint: t('design.ex.room', { n: '14' }) },
    { value: 'r3', label: 'Meier Elsa', hint: t('design.ex.room', { n: '15' }) },
  ]
  const na = (s: DsState) => s === 'loading' || s === 'success'
  const lbl = t('design.fields.name')
  const rows: { key: string; title: string; target: string; selection?: boolean; render: (s: DsState) => React.ReactNode | null }[] = [
    {
      key: 'text', title: 'TextField', target: '.field',
      render: (s) => na(s) ? null : <TextField label={lbl} hideLabel disabled={s === 'disabled'} error={s === 'error' ? err : undefined} defaultValue={s === 'active' ? 'Keller' : undefined} placeholder={t('design.fields.namePh')} />,
    },
    {
      key: 'select', title: 'Select', target: '.sel-btn',
      render: (s) => s === 'success' ? null : (
        <Select label={t('design.fields.unit')} hideLabel loading={s === 'loading'} disabled={s === 'disabled'} error={s === 'error' ? err : undefined} defaultValue={s === 'active' || s === 'loading' ? 'wg2' : ''} placeholder={t('design.fields.choose')}>
          {units.map((u) => <option key={u.v} value={u.v}>{u.l}</option>)}
        </Select>
      ),
    },
    {
      key: 'combobox', title: 'Combobox', target: '.cb-in',
      render: (s) => na(s) ? null : <Combobox label={t('design.fields.person')} hideLabel options={people} disabled={s === 'disabled'} error={s === 'error' ? err : undefined} defaultValue={s === 'active' ? 'r2' : null} placeholder={t('design.fields.personPh')} clearable />,
    },
    {
      key: 'number', title: 'NumberField', target: '.nf-in',
      render: (s) => na(s) ? null : <NumberField label={t('design.fields.temp')} hideLabel unit="°C" min={30} max={45} step={0.1} warn={{ lo: 35.5, hi: 38 }} disabled={s === 'disabled'} error={s === 'error' ? t('design.fields.errTemp') : undefined} defaultValue={s === 'active' ? 36.8 : undefined} />,
    },
    {
      key: 'textarea', title: 'Textarea', target: 'textarea',
      render: (s) => na(s) ? null : <Textarea label={t('design.fields.note')} hideLabel rows={2} disabled={s === 'disabled'} error={s === 'error' ? err : undefined} defaultValue={s === 'active' ? t('design.ex.noteText') : undefined} style={{ minHeight: 60 }} />,
    },
    {
      key: 'date', title: 'DateField', target: '.field',
      render: (s) => na(s) ? null : <DateField label={t('design.fields.date')} hideLabel disabled={s === 'disabled'} error={s === 'error' ? err : undefined} defaultValue={s === 'active' ? '2026-10-22' : undefined} />,
    },
    {
      key: 'time', title: 'TimeField', target: '.field',
      render: (s) => na(s) ? null : <TimeField label={t('design.fields.time')} hideLabel disabled={s === 'disabled'} error={s === 'error' ? err : undefined} defaultValue={s === 'active' ? '07:30' : undefined} />,
    },
    {
      key: 'checkbox', selection: true, title: 'Checkbox', target: '.cbx',
      render: (s) => na(s) ? null : <Checkbox label={t('design.fields.consent')} disabled={s === 'disabled'} error={s === 'error' ? err : undefined} defaultChecked={s === 'active'} />,
    },
    {
      key: 'switch', selection: true, title: 'Switch', target: '.sw',
      render: (s) => na(s) ? null : <Switch label={t('design.fields.pushShort')} disabled={s === 'disabled'} error={s === 'error' ? err : undefined} defaultChecked={s === 'active'} />,
    },
    {
      key: 'radio', selection: true, title: 'RadioGroup', target: '.rg-opt',
      render: (s) => na(s) ? null : (
        <RadioGroup name={'ds-rg-' + s} label={t('design.fields.mobility')} hideLabel disabled={s === 'disabled'} error={s === 'error' ? err : undefined} defaultValue={s === 'active' ? 'b' : undefined}
          options={[{ value: 'a', label: t('design.ex.mobA') }, { value: 'b', label: t('design.ex.mobB') }]} />
      ),
    },
    {
      key: 'seg', selection: true, title: 'SegmentedControl · .seg', target: '.seg button:not([aria-checked="true"])',
      render: (s) => s === 'error' || na(s) ? null : (
        <SegmentedControl name={'ds-seg-' + s} label={t('design.fields.shift')} hideLabel disabled={s === 'disabled'} defaultValue={s === 'active' ? 'n' : 'f'}
          options={[{ value: 'f', label: t('design.ex.early') }, { value: 's', label: t('design.ex.late') }, { value: 'n', label: t('design.ex.night') }]} />
      ),
    },
    {
      key: 'chip', selection: true, title: 'Chip · .chip', target: '.chip',
      render: (s) => s === 'error' || na(s) ? null : <button type="button" className="chip" aria-pressed={s === 'active'} disabled={s === 'disabled'}>{t('design.ex.chip')}</button>,
    },
    {
      key: 'tabs', selection: true, title: 'Register · .tabs', target: '.tabs a:last-child',
      render: (s) => s === 'error' || s === 'disabled' || na(s) ? null : (
        <nav className="tabs ds-tabs" aria-label={t('design.ex.tabs') + ' · ' + t('design.state.' + s)}>
          <a href="#ds-states" aria-current={s !== 'active' ? 'page' : undefined}>{t('design.ex.tab1')}</a>
          <a href="#ds-states" aria-current={s === 'active' ? 'page' : undefined}>{t('design.ex.tab2')}</a>
        </nav>
      ),
    },
  ]
  return (
    <>
      <p className="small muted ds-note">{t('design.forced')} {t('design.fieldsLegend')}</p>
      <div className="ds-grid">
        {rows.map((r) => <StateGrid key={r.key} title={r.title} target={r.target} render={r.render} selection={r.selection} />)}
      </div>
    </>
  )
}
