import { SkelMetrics, SkelSec, SkelTable, SkelView } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <SkelView>
      <SkelMetrics n={4} />
      <SkelSec action />
      <SkelTable rows={8} cols={5} />
    </SkelView>
  )
}
