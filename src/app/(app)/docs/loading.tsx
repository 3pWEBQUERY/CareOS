import { Block, SkelTable, SkelView } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <SkelView>
      <div className="row" aria-hidden="true"><Block w={280} h={34} /><Block w={160} h={34} /></div>
      <SkelTable rows={8} cols={5} />
    </SkelView>
  )
}
