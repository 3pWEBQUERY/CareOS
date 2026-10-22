import { Bar, Block, Busy, SkelSec, SkelTable } from '@/components/ui/Skeleton'

/** Vitalwerte: Erfassung oben, letzte Messungen darunter – gleiche Abfolge wie das fertige Register (PRD §31). */
export default function Loading() {
  return (
    <>
      <Busy />
      <SkelSec w={130} />
      <section className="card" aria-hidden="true">
        <div className="card-body stack-sm">
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
            {Array.from({ length: 8 }, (_, i) => (
              <div className="fld" key={i}><span className="lbl"><Bar w={70} /></span><Block h={34} /></div>
            ))}
          </div>
          <Block w={150} h={34} />
        </div>
      </section>
      <SkelSec w={150} />
      <SkelTable rows={6} cols={6} />
    </>
  )
}
