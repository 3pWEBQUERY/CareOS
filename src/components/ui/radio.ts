import type { KeyboardEvent } from 'react'

/**
 * Pfeiltasten in einer Auswahlgruppe (role="radiogroup" mit Buttons role="radio"), WAI-ARIA Radio Group:
 * ←/↑ wählt die vorherige, →/↓ die nächste Option (mit Umlauf), Pos1/Ende die erste bzw. letzte.
 * Auswahl über den Klick des Buttons, damit dieselbe Logik wie mit Maus und Leertaste greift.
 */
export function onRadioKeys(e: KeyboardEvent<HTMLElement>) {
  const keys = ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])')]
  const i = items.indexOf(document.activeElement as HTMLElement)
  if (i < 0 || !items.length) return
  e.preventDefault()
  const n = items.length
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + n) % n : (i + 1) % n
  items[next].focus()
  items[next].click()
}
