import { Block, SkelList, SkelView } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <SkelView>
      <div className="ppl-bar" aria-hidden="true"><Block w={320} h={40} /><Block w={200} h={40} /><Block w={260} h={30} /></div>
      <SkelList n={8} head={false} />
    </SkelView>
  )
}
