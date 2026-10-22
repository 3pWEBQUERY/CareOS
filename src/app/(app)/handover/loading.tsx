import { Bar, Block, SkelMetrics, SkelView } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <SkelView actions={2}>
      <div className="row-between" aria-hidden="true"><Block w={180} h={28} /><Block w={220} h={34} /></div>
      <SkelMetrics n={4} bar />
      <div className="ho-list" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <section className="ho" key={i}>
            <div className="ho-head"><span className="roomtag"><Bar w={24} /></span><strong><Bar w={160} /></strong><span className="push"><Block w={110} h={28} /></span></div>
            <div className="ho-body">
              {[0, 1, 2, 3].map((c) => (
                <div className="ho-col" key={c}>
                  <span className="lbl"><Bar w={70} /></span>
                  <ul><li><Bar w="80%" /></li><li><Bar w="60%" /></li></ul>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </SkelView>
  )
}
