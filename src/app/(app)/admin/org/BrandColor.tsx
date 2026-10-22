'use client'

import { useState } from 'react'
import { useT } from '@/i18n/client'
import { HEX_RE, contrastRatio } from '@/lib/admin-shared'
import { ColorField } from '@/components/ui/fields'

/** Akzentfarbe mit Live-Prüfung des Kontrasts gegen Weiss (WCAG AA, ≥ 4.5:1). */
export function BrandColorField({ initial }: { initial: string | null }) {
  const t = useT()
  const [v, setV] = useState(initial ?? '')
  const valid = HEX_RE.test(v)
  const ratio = valid ? contrastRatio(v, '#FFFFFF') : null
  const pass = ratio != null && ratio >= 4.5
  return (
    <div className="stack-sm">
      <ColorField
        label={t('admin.org.brandColor')}
        name="brandColor"
        value={v}
        onChange={setV}
        optional
        hint={v === '' ? t('admin.org.brandColorDefault') : valid && pass ? t('admin.org.contrastOk') : undefined}
        error={v === '' ? undefined : !valid ? t('admin.org.badColor') : !pass ? t('admin.org.contrastLow') : undefined}
      >
        {ratio != null && <span className={'tag ' + (pass ? 'ok' : 'crit')}>{(pass ? '✓ ' : '✕ ') + t('admin.org.ratio', { ratio: ratio.toFixed(2) })}</span>}
      </ColorField>
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
