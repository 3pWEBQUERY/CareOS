/** Linien-Icons 20×20, 1.5px Strich – im Stil des Stationsarbeitsplatzes. */
type P = { size?: number; className?: string }
const S = ({ size = 20, className, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

export const IconHome = (p: P) => <S {...p}><path d="M3 9.5 10 3.5l7 6V17H12.5v-4.5h-5V17H3z" /></S>
export const IconResidents = (p: P) => <S {...p}><rect x="3.5" y="3" width="13" height="15" rx="2" /><path d="M7 3V1.75h6V3M7 9h6M7 12.5h6M7 16h3.5" /></S>
export const IconTasks = (p: P) => <S {...p}><path d="M3 5h14M3 10h14M3 15h14" /><circle cx="6" cy="5" r="1.6" fill="currentColor" /><circle cx="12" cy="10" r="1.6" fill="currentColor" /><circle cx="9" cy="15" r="1.6" fill="currentColor" /></S>
export const IconHandover = (p: P) => <S {...p}><path d="M3 7h12l-3-3M17 13H5l3 3" /></S>
export const IconSchedule = (p: P) => <S {...p}><rect x="3" y="4" width="14" height="13" rx="2" /><path d="M3 8h14M7 2.5v3M13 2.5v3M6.5 11.5h2M11.5 11.5h2M6.5 14.5h2" /></S>
export const IconTeam = (p: P) => <S {...p}><circle cx="7.5" cy="7" r="2.75" /><path d="M2.5 16.5c.5-3 2.5-4.5 5-4.5s4.5 1.5 5 4.5" /><circle cx="14" cy="7.5" r="2" /><path d="M14.5 12c1.8.3 2.9 1.6 3.2 3.8" /></S>
export const IconChat = (p: P) => <S {...p}><path d="M3.5 4.5h13v9h-7l-4 3v-3h-2z" /></S>
export const IconLearn = (p: P) => <S {...p}><path d="M2.5 7.5 10 4l7.5 3.5L10 11z" /><path d="M5.5 9v4c1.2 1.3 2.7 2 4.5 2s3.3-.7 4.5-2V9M17.5 7.5V12" /></S>
export const IconDocs = (p: P) => <S {...p}><path d="M5 2.75h6.5L15 6.25V17.25H5z" /><path d="M11.5 2.75v3.5H15M7.5 10h5M7.5 13h5" /></S>
export const IconInsights = (p: P) => <S {...p}><path d="M3 17h14M5.5 14V9.5M10 14V5.5M14.5 14v-6" /></S>
export const IconQuality = (p: P) => <S {...p}><path d="M10 2.75 16 5v5c0 3.5-2.6 6-6 7.25C6.6 16 4 13.5 4 10V5z" /><path d="m7.25 10 2 2 3.5-4" /></S>
export const IconAdmin = (p: P) => <S {...p}><circle cx="10" cy="10" r="2.5" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></S>
export const IconMore = (p: P) => <S {...p}><circle cx="4.5" cy="10" r="1.2" fill="currentColor" /><circle cx="10" cy="10" r="1.2" fill="currentColor" /><circle cx="15.5" cy="10" r="1.2" fill="currentColor" /></S>
export const IconBell = (p: P) => <S {...p}><path d="M5 14.5V9a5 5 0 0 1 10 0v5.5l1.5 1.5h-13zM8.25 17.5a1.9 1.9 0 0 0 3.5 0" /></S>
export const IconSearch = ({ size = 14 }: P) => (
  <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M9.5 9.5 13 13" stroke="currentColor" strokeWidth="1.5" /></svg>
)
export const IconSun = (p: P) => <S {...p}><circle cx="10" cy="10" r="3.25" /><path d="M10 2.5v1.75M10 15.75v1.75M2.5 10h1.75M15.75 10h1.75M4.7 4.7l1.25 1.25M14.05 14.05l1.25 1.25M4.7 15.3l1.25-1.25M14.05 5.95l1.25-1.25" /></S>
export const IconMoon = (p: P) => <S {...p}><path d="M15.5 12.5A6.5 6.5 0 0 1 7.5 4.5a6.5 6.5 0 1 0 8 8z" /></S>
export const IconPlus = (p: P) => <S {...p}><path d="M10 4v12M4 10h12" /></S>
export const IconCheck = ({ size = 12 }: P) => (
  <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5 5 9.5 10 3" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
)
export const IconClose = (p: P) => <S {...p}><path d="M5 5l10 10M15 5 5 15" /></S>
export const IconPill = (p: P) => <S {...p}><rect x="2.5" y="7" width="15" height="6" rx="3" transform="rotate(-35 10 10)" /><path d="m8.3 7.6 3.4 4.8" /></S>
export const IconWarn = (p: P) => <S {...p}><path d="M10 3 18 16.5H2z" /><path d="M10 8v4M10 14.25v.25" /></S>
export const IconMic = (p: P) => <S {...p}><rect x="7.5" y="2.75" width="5" height="9" rx="2.5" /><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" /></S>
export const IconSpark = (p: P) => <S {...p}><path d="M10 3v3M10 14v3M3 10h3M14 10h3M5.5 5.5l1.8 1.8M12.7 12.7l1.8 1.8M5.5 14.5l1.8-1.8M12.7 7.3l1.8-1.8" /></S>
export const IconCamera = (p: P) => <S {...p}><path d="M3 6.5h3l1.5-2h5L14 6.5h3V16H3z" /><circle cx="10" cy="11" r="3" /></S>
export const IconFile = (p: P) => <S {...p}><path d="M5 2.75h6.5L15 6.25V17.25H5z" /><path d="M11.5 2.75v3.5H15" /></S>
export const IconUpload = (p: P) => <S {...p}><path d="M10 13V3.5M6.5 7 10 3.5 13.5 7M3.5 13.5v3h13v-3" /></S>
export const IconExternal = (p: P) => <S {...p}><path d="M11 3.5h5.5V9M16.5 3.5 9 11M14 12v4.5H3.5V6H8" /></S>
// Navigation Therapie, Angehörige, Spitex, Developer-Portal (Paket P)
export const IconTherapy = (p: P) => <S {...p}><circle cx="10" cy="3.75" r="1.75" /><path d="M10 6.5v5l-3 5.5M10 11.5l3 5.5M6 9h8" /></S>
export const IconFamily = (p: P) => <S {...p}><path d="M10 16.5s-6-3.6-6-8A3.2 3.2 0 0 1 10 6.6 3.2 3.2 0 0 1 16 8.5c0 4.4-6 8-6 8z" /></S>
export const IconHomecare = (p: P) => <S {...p}><path d="M3 9.5 10 3.5l7 6V17H3z" /><path d="M10 9v5M7.5 11.5h5" /></S>
export const IconCode = (p: P) => <S {...p}><path d="M7 6 3 10l4 4M13 6l4 4-4 4M11 4.5l-2 11" /></S>
