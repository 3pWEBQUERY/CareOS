import { Bar, Busy, SkelSec } from '@/components/ui/Skeleton'

/** Register der Akte: lädt nur innerhalb des .tabpanel, Banner und Register bleiben stehen (schneller Bewohnerwechsel, PRD §31). */
export default function Loading() {
  return (
    <>
      <Busy />
      <SkelSec action />
      <ol className="notes" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <li className="note" key={i}>
            <time className="mono"><Bar w={70} /></time>
            <div style={{ minWidth: 0 }}>
              <div className="nh"><Bar w={64} h={14} /><Bar w={110} /></div>
              <p><Bar w={['86%', '64%', '78%', '52%', '70%'][i]} /></p>
            </div>
          </li>
        ))}
      </ol>
    </>
  )
}
