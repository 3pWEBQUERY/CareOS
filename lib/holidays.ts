import Holidays from "date-holidays";
import type { CountryCode } from "@/lib/country";

// Gesetzliche Feiertage je Land und Kanton bzw. Bundesland (Daten: date-holidays, nur Typ „public“, deutsche
// Namen). Ohne Region die landesweiten Feiertage. Fallen zwei auf denselben Tag, werden die Namen verbunden.
export function publicHolidays(country: CountryCode, region: string | null, year: number) {
  const calendar = region
    ? new Holidays(country, region, { languages: ["de"] })
    : new Holidays(country, { languages: ["de"] });
  const byDate = new Map<string, string>();
  for (const holiday of calendar.getHolidays(year)) {
    if (holiday.type !== "public") continue;
    const date = holiday.date.slice(0, 10);
    const name = holiday.name.slice(0, 120);
    byDate.set(date, byDate.has(date) ? `${byDate.get(date)} / ${name}`.slice(0, 120) : name);
  }
  return [...byDate].map(([date, name]) => ({ date, name })).sort((a, b) => a.date.localeCompare(b.date));
}
