import { SkelMetrics, SkelSec, SkelTable, SkelView } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <SkelView actions={0} tabs={3}>
      <SkelMetrics n={4} />
      <SkelSec />
      <SkelTable rows={5} cols={4} />
    </SkelView>
  )
}
