import { ForbiddenTitle } from '@/components/ui/ErrorState'

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <span className="small">{children}</span>}
      {action}
    </div>
  )
}

/** Hinweis, wenn eine Berechtigung fehlt. Gleicher Seitenaufbau wie jede Ansicht (view-head mit h1). */
export function Forbidden({ text, title }: { text: string; title?: string }) {
  return (
    <main className="panel main" style={{ flex: 1 }}>
      <div className="view-head">{title ? <h1>{title}</h1> : <ForbiddenTitle />}</div>
      <div className="tabpanel"><div className="alert warn" role="alert"><span className="grow">{text}</span></div></div>
    </main>
  )
}
