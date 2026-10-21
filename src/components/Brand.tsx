export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" rx="2" fill="var(--accent)" />
      <rect x="12" y="1" width="9" height="9" rx="2" fill="var(--accent)" />
      <rect x="1" y="12" width="9" height="9" rx="2" fill="var(--accent)" />
      <rect x="12.75" y="12.75" width="7.5" height="7.5" rx="1.5" fill="none" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  )
}

export function Brand({ name, logoUrl }: { name?: string | null; logoUrl?: string | null }) {
  return (
    <span className="brand">
      {logoUrl ? <img src={logoUrl} alt="" height={22} style={{ height: 22, width: 'auto', borderRadius: 3 }} /> : <BrandMark />}
      {name ? <span>{name}</span> : <span>Care<b>OS</b></span>}
    </span>
  )
}
