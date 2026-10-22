import { Busy, SkelHead, SkelTable } from '@/components/ui/Skeleton'

/** Admin: nur der Inhaltsbereich rechts der Unternavigation lädt. */
export default function Loading() {
  return (
    <main className="panel main" aria-busy="true">
      <Busy />
      <SkelHead actions={0} />
      <div className="scroll">
        <div className="tabpanel">
          <SkelTable rows={6} cols={4} />
        </div>
      </div>
    </main>
  )
}
