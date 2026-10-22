import { SkelList, SkelView } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <SkelView actions={2}>
      <div className="grid-2">
        <div className="stack"><SkelList n={3} /><SkelList n={4} /></div>
        <div className="stack"><SkelList n={3} /><SkelList n={3} /></div>
      </div>
    </SkelView>
  )
}
