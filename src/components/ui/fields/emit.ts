/**
 * Eigene Felder schreiben ihren Wert in ein verstecktes <input>. Damit Formulare, die auf «change» hören
 * (z. B. Filterzeilen mit Sofort-Übernahme), die Änderung bemerken, löst das versteckte Feld ein natives,
 * blubberndes change-Ereignis aus. React-onChange am <form> sieht es nicht – dort einen nativen Listener verwenden.
 */
export function emitChange(el: HTMLInputElement | null) {
  el?.dispatchEvent(new Event('change', { bubbles: true }))
}
