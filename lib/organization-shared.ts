// Types and labels of "Leitung · Organisation", shared by the API and the page.

export const SERVICES = { early: "Frühdienst", late: "Spätdienst", night: "Nachtwache" } as const;
export type ServiceKey = keyof typeof SERVICES;

export const SITE_STATUS = { active: "Aktiv", planned: "In Vorbereitung", archived: "Archiviert" } as const;
export type SiteStatus = keyof typeof SITE_STATUS;

export const SITE_TYPES = ["Seniorenresidenz", "Pflegezentrum", "Tagespflege", "Ambulante Dienste"];
export const COUNTRIES = ["Schweiz", "Deutschland", "Österreich"];
export const FLOORS = ["EG", "1. OG", "2. OG", "3. OG", "4. OG"];

export type OrgPerson = { id: string; name: string; jobTitle: string };

export type OrgSite = {
  id: string;
  name: string;
  code: string;
  siteType: string;
  country: string;
  addressLine1: string;
  postalCode: string;
  city: string;
  phone: string;
  email: string;
  status: SiteStatus;
  managerId: string | null;
  managerName: string | null;
  notes: string;
  staff: number;
};

export type OrgUnit = {
  id: string;
  siteId: string;
  siteName: string;
  name: string;
  code: string;
  floor: string;
  capacity: number | null;
  specialty: string;
  services: ServiceKey[];
  notes: string;
  active: boolean;
  leadId: string | null;
  leadName: string | null;
  rooms: number;
  beds: number;
  occupied: number;
  staff: number;
  updatedAt: string | null;
};

export type OrganizationStructure = {
  organization: { id: string; name: string; legalName: string };
  sites: OrgSite[];
  units: OrgUnit[];
  people: OrgPerson[];
  totals: {
    sites: number;
    units: number;
    places: number;
    occupied: number;
    staff: number;
    roles: number;
    unassignedStaff: number;
    unitsWithoutLead: number;
  };
};

// Places of a unit: the configured capacity, otherwise the beds of its rooms.
export const unitPlaces = (unit: Pick<OrgUnit, "capacity" | "beds">) => unit.capacity ?? unit.beds;
