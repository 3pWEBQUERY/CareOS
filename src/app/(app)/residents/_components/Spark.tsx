/** Kleine Verlaufslinie (Resident 360, Einheitenübersicht). Rein serverseitig renderbar. */
export function Spark({ values, label }: { values: (number | null)[]; label: string }) {
  const vs = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null)
  if (vs.length < 2) return <svg className="spark" viewBox="0 0 100 28" role="img" aria-label={label} />
  const ys = vs.map((p) => p[1])
  let mn = Math.min(...ys)
  let mx = Math.max(...ys)
  if (mx - mn < 1e-9) { mn -= 1; mx += 1 }
  const n = Math.max(values.length - 1, 1)
  const pts = vs.map(([i, v]) => `${((i / n) * 98 + 1).toFixed(2)},${(26 - ((v - mn) / (mx - mn)) * 24).toFixed(2)}`).join(' ')
  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label={label}>
      <polyline points={pts} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
