import { Block, SkelMetrics, SkelView } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <SkelView>
      <Block h={52} />
      <div className="row" aria-hidden="true"><Block w={200} h={34} /><Block w={160} h={34} /></div>
      <SkelMetrics n={4} />
      <div className="charts" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => <Block key={i} h={220} />)}
      </div>
    </SkelView>
  )
}
