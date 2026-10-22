import { Block, SkelList, SkelMetrics, SkelSec, SkelView } from '@/components/ui/Skeleton'

/** Allgemeiner Ladezustand (Home und Ansichten ohne eigenen Skeleton), PRD §31. */
export default function Loading() {
  return (
    <SkelView>
      <SkelMetrics n={4} />
      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
        <div className="stack">
          <SkelSec />
          <SkelList n={3} />
          <SkelList n={2} />
        </div>
        <div className="stack">
          <SkelSec w={120} />
          <Block h={260} />
        </div>
      </div>
    </SkelView>
  )
}
