/** Color categories for previousUse values — shared by SpaceMap legend + cards */

export type SpaceTypeCategory =
  | "food" | "retail" | "office" | "industrial"
  | "community" | "commercial" | "general" | "unknown";

export const PREVIOUS_USE_TO_CATEGORY: Record<string, SpaceTypeCategory> = {
  "Cafe":                     "food",
  "Coffee shop":              "food",
  "Restaurant":               "food",
  "Grocery / market":         "food",
  "Boutique retail":          "retail",
  "Retail":                   "retail",
  "Retail / office":          "retail",
  "Bookstore":                "retail",
  "Office":                   "office",
  "Office / religious":       "office",
  "Medical / dental offices": "office",
  "Industrial":               "industrial",
  "Auto repair":              "industrial",
  "Flex space":               "industrial",
  "Parking structure":        "industrial",
  "Surface parking":          "industrial",
  "Religious / community":    "community",
  "Institutional":            "community",
  "Hotel / lodging":          "community",
  "Commercial":               "commercial",
  "General":                  "general",
};

export const CATEGORY_HEX: Record<SpaceTypeCategory, string> = {
  food:       "#f97316",  // orange-500
  retail:     "#8b5cf6",  // violet-500
  office:     "#3b82f6",  // blue-500
  industrial: "#6b7280",  // gray-500
  community:  "#ec4899",  // pink-500
  commercial: "#f59e0b",  // amber-500
  general:    "#10b981",  // emerald-500
  unknown:    "#10b981",  // emerald-500
};

export const CATEGORY_LABEL: Record<SpaceTypeCategory, string> = {
  food:       "Food & Drink",
  retail:     "Retail",
  office:     "Office / Medical",
  industrial: "Industrial",
  community:  "Community / Civic",
  commercial: "Commercial",
  general:    "General / Other",
  unknown:    "Unknown",
};

export function getCategoryForUse(previousUse: string | null | undefined): SpaceTypeCategory {
  if (!previousUse) return "unknown";
  return PREVIOUS_USE_TO_CATEGORY[previousUse] ?? "unknown";
}

export function getHexForUse(previousUse: string | null | undefined): string {
  return CATEGORY_HEX[getCategoryForUse(previousUse)];
}
