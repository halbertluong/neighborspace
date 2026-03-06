// Simple feasibility rules: idea category vs space constraints (sq ft, zoning).
// Returns { feasible: boolean, message?: string }.

const CATEGORY_MIN_SQFT: Record<string, number> = {
  "Coffee / Cafe": 400,
  "Restaurant": 1200,
  "Retail / Shop": 500,
  "Fitness / Gym": 2000,
  "Indoor sports (e.g. pickleball)": 8000,
  "Arts & Culture / Studio": 600,
  "Childcare / Daycare": 1500,
  "Coworking": 1000,
  "Bar / Lounge": 800,
  "Other": 0,
};

const ZONING_ALLOWS_FOOD = ["CM1", "CM2", "CM3", "CX", "CG", "RG"];
const ZONING_ALLOWS_RETAIL = ["CM1", "CM2", "CM3", "CX", "CG", "RG", "EX"];

export function checkFeasibility(
  category: string,
  squareFeet: number | null,
  zoningCode: string | null
): { feasible: boolean; message?: string } {
  const sqft = squareFeet ?? 0;
  const zone = (zoningCode ?? "").toUpperCase();

  if (category.toLowerCase().includes("restaurant") || category === "Bar / Lounge") {
    if (zone && !ZONING_ALLOWS_FOOD.some((z) => zone.startsWith(z)))
      return { feasible: false, message: "Zoning may not allow food/beverage use. Your idea can still be submitted for review." };
  }

  const minSqft = CATEGORY_MIN_SQFT[category] ?? 0;
  if (minSqft > 0 && sqft > 0 && sqft < minSqft)
    return {
      feasible: false,
      message: `This space is ${sqft} sq ft; ${category} typically needs at least ${minSqft} sq ft. You can still submit for community visibility.`,
    };

  return { feasible: true };
}

export const IDEA_CATEGORIES = Object.keys(CATEGORY_MIN_SQFT);
