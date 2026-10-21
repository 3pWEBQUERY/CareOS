'use client'

/** CSV-Export einer Tabelle direkt im Browser (Semikolon, UTF-8 mit BOM für Excel de-CH). */
export function CsvButton({ name, head, rows, label }: { name: string; head: string[]; rows: (string | number)[][]; label: string }) {
  return (
    <button
      type="button"
      className="btn sm"
      onClick={() => {
        const esc = (v: string | number) => {
          const s = String(v)
          return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
        }
        const csv = [head, ...rows].map((r) => r.map(esc).join(';')).join('\r\n')
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = name.replace(/[^\w.-]+/g, '_') + '.csv'
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }}
    >
      {label}
    </button>
  )
}
