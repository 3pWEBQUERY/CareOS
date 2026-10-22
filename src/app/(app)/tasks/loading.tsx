import { Block, SkelMetrics, SkelTable, SkelView } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <SkelView>
      <div className="row-between" aria-hidden="true"><Block w={340} h={34} /><Block w={300} h={34} /></div>
      <SkelMetrics n={4} />
      <SkelTable rows={8} cols={5} />
    </SkelView>
  )
}
