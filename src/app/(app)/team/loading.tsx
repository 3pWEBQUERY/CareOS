import { SkelList, SkelMetrics, SkelView } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <SkelView>
      <SkelMetrics n={4} />
      <div className="team-grid">
        <div className="stack"><SkelList n={5} /></div>
        <div className="stack"><SkelList n={3} /><SkelList n={3} /></div>
      </div>
    </SkelView>
  )
}
