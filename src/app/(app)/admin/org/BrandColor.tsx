'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { HEX_RE, contrastRatio } from '@/lib/admin-shared'

/** Akzentfarbe mit Live-Prüfung des Kontrasts gegen Weiss (WCAG AA, ≥ 4.5:1). */
export function BrandColorField({ initial }: { initial: string | null }) {
  const t = useT()
  const [v, setV] = useState(initial ?? '')
  const valid = HEX_RE.test(v)
  const ratio = valid ? contrastRatio(v, '#FFFFFF') : null
  const pass = ratio != null && ratio >= 4.5
  return (
    <div className="fld">
      <span className="lbl">{t('admin.org.brandColor')}</span>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input type="color" aria-label={t('admin.org.brandColorPicker')} value={valid ? v : '#0B5F74'} onChange={(e) => setV(e.target.value.toUpperCase())} style={{ width: 40, height: 34, padding: 2, border: '1px solid var(--line)', borderRadius: 'var(--r)', background: 'var(--surface-2)' }} />
        <input className="field mono" name="brandColor" value={v} placeholder="#0B5F74" maxLength={7} onChange={(e) => setV(e.target.value.trim())} aria-invalid={v !== '' && !pass} style={{ maxWidth: 130 }} />
        {ratio != null && <span className={'tag ' + (pass ? 'ok' : 'crit')}>{(pass ? '✓ ' : '✕ ') + t('admin.org.ratio', { ratio: ratio.toFixed(2) })}</span>}
      </div>
      <span className="hint">{v === '' ? t('admin.org.brandColorDefault') : !valid ? t('admin.org.badColor') : pass ? t('admin.org.contrastOk') : t('admin.org.contrastLow')}</span>
      {valid && (
        <div className="row" style={{ marginTop: 6 }} aria-hidden="true">
          <span className="btn sm" style={{ background: v, borderColor: v, color: '#fff' }}>{t('admin.org.previewButton')}</span>
          <span className="tag" style={{ background: `color-mix(in srgb, ${v} 14%, #fff)`, color: v }}>{t('admin.org.previewTag')}</span>
          <span style={{ color: v, fontWeight: 500 }}>{t('admin.org.previewLink')}</span>
        </div>
      )}
    </div>
  )
}
