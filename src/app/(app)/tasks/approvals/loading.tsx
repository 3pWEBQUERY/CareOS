import { SkelList, SkelView } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <SkelView actions={0}>
      <SkelList n={4} head={false} />
    </SkelView>
  )
}
