import { Bar, Busy, SkelHead } from '@/components/ui/Skeleton'

/** Chat: Unterhaltungsliste links, Verlauf rechts – wie die fertige Ansicht, ohne Springen (PRD §31). */
export default function Loading() {
  return (
    <main className="panel main" style={{ flex: 1 }} aria-busy="true">
      <Busy />
      <SkelHead actions={1} sub={false} title={80} />
      <div className="chat" aria-hidden="true">
        <nav className="chat-list">
          <ul className="list">
            {[0, 1, 2, 3].map((i) => (
              <li key={i}>
                <div className="li">
                  <span className="av muted" />
                  <div className="grow">
                    <div><Bar w={['55%', '40%', '62%', '48%'][i]} /></div>
                    <div className="small"><Bar w="80%" /></div>
                  </div>
                  <span className="small mono"><Bar w={34} /></span>
                </div>
              </li>
            ))}
          </ul>
        </nav>
        <section className="chat-main" />
      </div>
    </main>
  )
}
