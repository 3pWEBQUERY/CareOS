import { Block, SkelMetrics, SkelTable, SkelView } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <SkelView>
      <SkelMetrics n={4} />
      <div className="row" aria-hidden="true"><Block w={180} h={34} /><Block w={180} h={34} /><Block w={140} h={34} /></div>
      <SkelTable rows={7} cols={6} />
    </SkelView>
  )
}
