export const THEME_COOKIE = 'careos_theme'
export type Theme = 'light' | 'dark' | 'system'
/** Hell ist Standard (Vorgabe). Dunkel oder System nur auf ausdrücklichen Wunsch. */
export const normalizeTheme = (v: string | undefined | null): Theme => (v === 'dark' || v === 'system' ? v : 'light')

/** Schriftgrösse pro Gerät (Cookie): skaliert alle rem-Grössen über die Wurzel-Schriftgrösse. */
export const TEXT_COOKIE = 'careos_text'
export type TextSize = 'm' | 'l' | 'xl'
export const TEXT_SIZES: readonly TextSize[] = ['m', 'l', 'xl']
export const normalizeTextSize = (v: string | undefined | null): TextSize => (v === 'l' || v === 'xl' ? v : 'm')
