import { Block, SkelSec, SkelView } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <SkelView actions={2} tabs={5}>
      <SkelSec />
      <Block h={360} />
    </SkelView>
  )
}
