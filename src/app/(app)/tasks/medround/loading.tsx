import { Bar, Block, SkelView } from '@/components/ui/Skeleton'

/** Medikamentenrunde: Fortschritt und Personenblöcke wie die fertige Runde (statt Aufgabentabelle), PRD §31. */
export default function Loading() {
  return (
    <SkelView actions={2}>
      <div className="round" aria-hidden="true">
        <div className="row-between"><Bar w={200} /><Block w={220} h={34} /></div>
        <Block h={6} />
        {[0, 1, 2].map((i) => (
          <section className="round-res" key={i}>
            <header>
              <span className="room"><Bar w={28} /></span>
              <h2><Bar w={[150, 130, 170][i]} /></h2>
              <span className="grow" />
              <Bar w={120} h={18} />
            </header>
            <div className="round-line">
              <div className="rl-drug">
                <div className="drug"><Bar w={180} /></div>
                <div className="drug-sub"><Bar w={120} /></div>
              </div>
              <div className="rl-dose"><span className="dosev"><Bar w={70} /></span><span className="small"><Bar w={60} /></span></div>
              <div className="round-act"><Block w={128} h={48} /><Block w={124} h={48} /><Block w={136} h={48} /></div>
            </div>
          </section>
        ))}
      </div>
    </SkelView>
  )
}
