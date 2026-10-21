export const THEME_COOKIE = 'careos_theme'
export type Theme = 'light' | 'dark' | 'system'
/** Hell ist Standard (Vorgabe). Dunkel oder System nur auf ausdrücklichen Wunsch. */
export const normalizeTheme = (v: string | undefined | null): Theme => (v === 'dark' || v === 'system' ? v : 'light')
