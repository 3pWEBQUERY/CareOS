import { Bar, Block, Busy, SkelSec } from '@/components/ui/Skeleton'

/** Tagesplan: Kennzahlen und Zeitleiste wie im fertigen Register, damit beim Laden nichts springt (PRD §31). */
export default function Loading() {
  return (
    <>
      <Busy />
      <div className="metrics res-metrics" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div className="metric" key={i}>
            <span className="lbl"><Bar w={120} /></span>
            <span className="val"><Bar w={64} /></span>
            {i < 2 ? <div className="bar" /> : <span className="small"><Bar w={160} /></span>}
          </div>
        ))}
      </div>
      <SkelSec w={140} action />
      <ol className="timeline" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <li className="trow" key={i}>
            <span className="t mono"><Bar w={38} /></span>
            <Block w={22} h={22} />
            <div style={{ minWidth: 0 }}>
              <div className="ttl"><Bar w={['46%', '58%', '40%', '52%', '36%', '48%', '44%'][i]} /></div>
              <div className="sub"><Bar w={120} /></div>
            </div>
            <Bar w={96} h={18} />
            <span className="mins"><Bar w={40} /></span>
          </li>
        ))}
      </ol>
    </>
  )
}
