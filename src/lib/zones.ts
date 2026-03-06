export type ZoneInfo = {
  label: string;        // short human name shown on badges
  description: string;  // tooltip / filter description
  color: string;        // tailwind color key (used for badge styling)
};

export const ZONE_INFO: Record<string, ZoneInfo> = {
  CM1: {
    label: "Neighborhood Corner",
    description: "Small local shops, cafés, services — walkable neighborhood scale",
    color: "sky",
  },
  CM2: {
    label: "Mixed-Use Strip",
    description: "Storefronts, restaurants, offices — typical commercial corridor",
    color: "indigo",
  },
  CM3: {
    label: "Commercial Corridor",
    description: "Larger retail, entertainment, multi-story mixed use",
    color: "violet",
  },
  CX: {
    label: "Downtown Core",
    description: "Most flexible — office towers, retail, hotels, anything goes",
    color: "purple",
  },
  CS: {
    label: "Auto-Oriented",
    description: "Car washes, gas stations, drive-throughs, auto services",
    color: "orange",
  },
  CG: {
    label: "General Retail",
    description: "Shopping centers, big-box, auto dealers, general services",
    color: "amber",
  },
  CR: {
    label: "Live + Work",
    description: "Transitional zone — small offices, studios, limited retail",
    color: "teal",
  },
  EX: {
    label: "Employment Hub",
    description: "Offices, creative studios, light industrial, limited retail",
    color: "cyan",
  },
};

export function getZoneInfo(code: string | null | undefined): ZoneInfo | null {
  if (!code) return null;
  return ZONE_INFO[code.toUpperCase()] ?? null;
}

export function getZoneLabel(code: string | null | undefined): string {
  if (!code) return "";
  return ZONE_INFO[code.toUpperCase()]?.label ?? code;
}

// Tailwind badge classes by color key
export const ZONE_BADGE_CLASSES: Record<string, string> = {
  sky:    "bg-sky-50 text-sky-700 ring-sky-200",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  purple: "bg-purple-50 text-purple-700 ring-purple-200",
  orange: "bg-orange-50 text-orange-700 ring-orange-200",
  amber:  "bg-amber-50 text-amber-700 ring-amber-200",
  teal:   "bg-teal-50 text-teal-700 ring-teal-200",
  cyan:   "bg-cyan-50 text-cyan-700 ring-cyan-200",
};

export function zoneBadgeClass(code: string | null | undefined): string {
  const info = getZoneInfo(code);
  return info ? (ZONE_BADGE_CLASSES[info.color] ?? "bg-stone-100 text-stone-600 ring-stone-200") : "bg-stone-100 text-stone-600 ring-stone-200";
}
