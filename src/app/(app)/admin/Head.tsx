import Link from 'next/link'

/** Kopfzeile einer Admin-Seite: Rücksprung zur Übersicht, Titel, Aktionen. */
export function AdminHead({ section, title, sub, children, href = '/admin' }: { section: string; title: string; sub?: string; children?: React.ReactNode; href?: string }) {
  return (
    <div className="view-head">
      <div style={{ minWidth: 0 }}>
        <Link href={href} className="lbl" style={{ textDecoration: 'none' }}>{section}</Link>
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  )
}
