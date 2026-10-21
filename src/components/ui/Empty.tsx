export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <span className="small">{children}</span>}
      {action}
    </div>
  )
}

/** Hinweis, wenn eine Berechtigung fehlt. */
export function Forbidden({ text }: { text: string }) {
  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="tabpanel"><div className="alert warn"><span className="grow">{text}</span></div></div>
    </main>
  )
}
