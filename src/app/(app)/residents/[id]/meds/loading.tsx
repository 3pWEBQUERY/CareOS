import { Bar, Block, Busy, SkelSec, SkelTable } from '@/components/ui/Skeleton'

/** Medikation: Abgabeliste (Kopf mit Tagwahl, Tabelle) und Reserve wie im fertigen Register (PRD §31). */
export default function Loading() {
  return (
    <>
      <Busy />
      <div className="sec-head" aria-hidden="true">
        <h2 className="sec"><Bar w={160} /></h2>
        <Block w={208} h={32} />
      </div>
      <SkelTable rows={3} cols={5} />
      <SkelSec w={90} />
      <SkelTable rows={2} cols={4} />
    </>
  )
}
