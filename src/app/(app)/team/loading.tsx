import { Block, SkelList, SkelMetrics, SkelView } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <SkelView>
      <SkelMetrics n={4} />
      <div className="row" aria-hidden="true"><Block w={420} h={28} /></div>
      <div className="team-grid">
        <div className="stack"><SkelList n={3} /><SkelList n={3} /></div>
        <div className="stack"><SkelList n={2} /><SkelList n={2} /></div>
      </div>
    </SkelView>
  )
}
