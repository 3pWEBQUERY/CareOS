import { Bar, Busy, SkelSec, SkelTabs } from '@/components/ui/Skeleton'

/** Bewohnerwechsel: Liste bleibt stehen, rechts erscheint die Akte als Skeleton (Banner, Register, Inhalt). */
export default function Loading() {
  return (
    <main className="panel main" aria-busy="true">
      <Busy />
      <section className="banner" aria-hidden="true">
        <div className="who">
          <h1><Bar w={220} /></h1>
          <div className="facts">
            {[0, 1, 2, 3].map((i) => (
              <div className="fact" key={i}><span className="lbl"><Bar w={60} /></span><span className="v"><Bar w={[90, 40, 30, 120][i]} /></span></div>
            ))}
          </div>
        </div>
      </section>
      <SkelTabs n={8} />
      <div className="scroll">
        <div className="tabpanel">
          <SkelSec />
          <div className="grid-2" aria-hidden="true">
            {[0, 1].map((i) => (
              <section className="card" key={i}>
                <div className="card-head"><h2><Bar w={140} /></h2></div>
                <div className="card-body stack-sm"><Bar w="80%" /><Bar w="60%" /><Bar w="70%" /></div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}
