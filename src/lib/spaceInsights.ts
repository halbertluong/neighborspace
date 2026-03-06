/**
 * Human-readable descriptions and suited-for suggestions for vacant spaces.
 *
 * Uses previousUse + zoningCode + squareFeet to generate context about each
 * building without requiring an API call or AI model.
 */

// ---------------------------------------------------------------------------
// Past-use descriptions
// ---------------------------------------------------------------------------

type PastUseInfo = {
  headline: string;       // "Formerly a neighborhood restaurant"
  body: string;           // 1–2 sentence narrative about the space
  assets: string[];       // likely physical assets still present
};

const PAST_USE_INFO: Record<string, PastUseInfo> = {
  "Retail": {
    headline: "Formerly a retail shop",
    body:
      "This space previously operated as a retail store. Retail conversions often retain strong natural light, street-facing display windows, and open floor plans designed to draw in foot traffic.",
    assets: ["Storefront windows", "Open floor plan", "Street-level visibility"],
  },
  "Restaurant": {
    headline: "Formerly a restaurant",
    body:
      "This space was last home to a restaurant. Restaurant conversions are especially valuable — they often retain kitchen ventilation hoods, grease traps, gas lines, and plumbing roughed in for commercial cooking, dramatically reducing build-out costs for any food-related concept.",
    assets: ["Commercial kitchen infrastructure", "Gas lines & ventilation", "Dining room layout", "Grease trap"],
  },
  "Grocery / market": {
    headline: "Formerly a grocery store or market",
    body:
      "Once operating as a grocery or food market, this space typically features wide column-free floor plates, heavy electrical capacity for refrigeration, and loading access for deliveries. These features make it well-suited for high-volume or destination retail.",
    assets: ["Wide open floor plate", "Heavy electrical capacity", "Loading dock or rear access", "Refrigeration infrastructure"],
  },
  "Hotel / lodging": {
    headline: "Formerly a hotel or lodging",
    body:
      "This building previously served as hotel or lodging. The plumbing infrastructure, room layouts, lobby, and commercial kitchen (if present) are assets that can be repurposed for hospitality, co-living, residential conversion, or health and wellness uses.",
    assets: ["Plumbing throughout", "Lobby / reception area", "Individual room layouts", "Possible commercial kitchen"],
  },
  "Office": {
    headline: "Formerly office space",
    body:
      "Most recently used as commercial office space, this building likely features divided floor plans, conference rooms, and data/power wiring. With Portland's high office vacancy rate, these spaces are prime candidates for creative reuse — from co-working and studios to live-work lofts and maker spaces.",
    assets: ["Data & power wiring", "Conference rooms", "HVAC systems", "Elevator access (if multi-story)"],
  },
  "Institutional": {
    headline: "Formerly an institutional building",
    body:
      "This space previously housed an institutional use — a school, church, community center, or similar civic facility. Institutional buildings often feature large assembly areas, strong structural bones, and flexible open space well suited for community and cultural programming.",
    assets: ["Large assembly / gathering space", "Strong structural capacity", "Community-oriented layout"],
  },
  "Religious / community": {
    headline: "Formerly a religious or community space",
    body:
      "Once a place of worship or community gathering, this space often features soaring ceilings, large open halls, and a design intended to welcome the public. These qualities make it ideal for arts venues, event spaces, markets, or community centers.",
    assets: ["High ceilings", "Large open hall", "Welcoming public entrance", "Gathering / event capacity"],
  },
  "Industrial": {
    headline: "Formerly an industrial building",
    body:
      "This space operated as light or medium industrial. Industrial buildings are increasingly sought after for creative reuse — their high ceilings, open spans, heavy floors, and loading infrastructure lend themselves to breweries, maker spaces, event venues, and food production.",
    assets: ["High ceilings", "Heavy floor loads", "Loading dock access", "Large open spans"],
  },
  "Parking structure": {
    headline: "Formerly a parking structure",
    body:
      "Originally built for vehicle parking, this space has an unusually large footprint and structural floor capacity that opens creative possibilities: markets, urban farms, event spaces, or mixed-use development.",
    assets: ["Large footprint", "Strong structural capacity", "Vehicle access ramps", "Open floor plates"],
  },
};

export function getPastUseInfo(previousUse: string | null | undefined): PastUseInfo | null {
  if (!previousUse) return null;
  return PAST_USE_INFO[previousUse] ?? null;
}

// ---------------------------------------------------------------------------
// Suited-for suggestions
// ---------------------------------------------------------------------------

export type SuitedUse = {
  emoji: string;
  label: string;
  note?: string;   // brief "why" hint
};

type SizeCategory = "micro" | "small" | "medium" | "large" | "anchor";

function sizeCategory(sqft: number | null | undefined): SizeCategory {
  if (!sqft) return "small";
  if (sqft < 1_000)  return "micro";
  if (sqft < 3_500)  return "small";
  if (sqft < 10_000) return "medium";
  if (sqft < 30_000) return "large";
  return "anchor";
}

// Base suggestions by zoning code
const ZONE_USES: Record<string, SuitedUse[]> = {
  CM1: [
    { emoji: "☕", label: "Café or coffee shop",       note: "walkable neighborhood staple" },
    { emoji: "📚", label: "Bookstore or library pop-up",note: "community gathering space" },
    { emoji: "🧴", label: "Boutique or gift shop",      note: "local goods, foot traffic" },
    { emoji: "💈", label: "Barbershop or salon",        note: "neighborhood services" },
    { emoji: "🧘", label: "Small yoga or fitness studio",note: "wellness at the corner" },
    { emoji: "🌿", label: "Specialty food shop",        note: "spice shop, deli, bakery" },
  ],
  CM2: [
    { emoji: "🍽️", label: "Restaurant or bistro",      note: "corridor dining destination" },
    { emoji: "🍺", label: "Bar or taproom",             note: "evening anchor use" },
    { emoji: "🎨", label: "Art gallery or studio",      note: "creative street presence" },
    { emoji: "💪", label: "Fitness studio or gym",      note: "strip corridor staple" },
    { emoji: "🛍️", label: "Specialty retail",           note: "curated goods, local brands" },
    { emoji: "💇", label: "Salon or wellness spa",      note: "recurring neighborhood service" },
    { emoji: "🧋", label: "Bubble tea or juice bar",    note: "casual daytime traffic" },
  ],
  CM3: [
    { emoji: "🎶", label: "Music venue or live events", note: "larger corridor can absorb noise" },
    { emoji: "🍻", label: "Brewery with taproom",       note: "destination draw + production" },
    { emoji: "💻", label: "Co-working space",           note: "mixed-use corridor demand" },
    { emoji: "🎥", label: "Cinema or screening room",   note: "entertainment anchor" },
    { emoji: "🎪", label: "Event or banquet venue",     note: "flexible multi-use" },
    { emoji: "🛒", label: "Specialty grocer or market", note: "underserved corridor retail" },
    { emoji: "🏋️", label: "Large fitness center",       note: "membership anchor" },
  ],
  CX: [
    { emoji: "🏨", label: "Boutique hotel",             note: "downtown hospitality" },
    { emoji: "🍴", label: "Food hall or market hall",   note: "multi-vendor destination" },
    { emoji: "💻", label: "Co-working or innovation hub",note: "downtown office alternative" },
    { emoji: "🏢", label: "Mixed-use residential conversion",note: "office-to-housing trend" },
    { emoji: "🛍️", label: "Flagship retail",            note: "downtown foot traffic" },
    { emoji: "🎭", label: "Cultural venue or theater",  note: "arts anchor for downtown" },
    { emoji: "🍽️", label: "Upscale restaurant",         note: "destination dining" },
  ],
  CS: [
    { emoji: "🚗", label: "Auto services or car wash",  note: "CS zoning is built for it" },
    { emoji: "🛻", label: "Drive-through café or restaurant", note: "auto-oriented footprint" },
    { emoji: "🏪", label: "Convenience store",          note: "high-visibility corner" },
    { emoji: "🔧", label: "Specialty trades or workshop",note: "auto-adjacent uses" },
    { emoji: "📦", label: "Fulfillment or last-mile hub",note: "growing e-commerce demand" },
  ],
  CG: [
    { emoji: "🛒", label: "Grocery or supermarket",     note: "underserved neighborhood need" },
    { emoji: "🏋️", label: "Large fitness or sports center", note: "big-box fitness" },
    { emoji: "🪴", label: "Garden center or nursery",   note: "big footprint, outdoor use" },
    { emoji: "🛋️", label: "Furniture or home goods",   note: "general retail anchor" },
    { emoji: "🐾", label: "Pet store or grooming center",note: "neighborhood service" },
    { emoji: "🍺", label: "Warehouse brewery or taproom",note: "popular CG reuse" },
  ],
  CR: [
    { emoji: "🎨", label: "Artist studio or gallery",   note: "live-work zone" },
    { emoji: "💼", label: "Small professional office",  note: "transitional zone use" },
    { emoji: "🪡", label: "Craft workshop or maker space", note: "hands-on production" },
    { emoji: "📸", label: "Photography or video studio",note: "creative industries" },
    { emoji: "🌿", label: "Wellness or therapy studio", note: "quiet neighborhood use" },
  ],
  EX: [
    { emoji: "🛠️", label: "Maker space or fab lab",     note: "employment hub fits" },
    { emoji: "🍺", label: "Craft brewery or distillery",note: "light industrial production" },
    { emoji: "💡", label: "Creative office or tech studio", note: "innovation cluster" },
    { emoji: "🏭", label: "Food production or commissary kitchen", note: "supports local food ecosystem" },
    { emoji: "🎬", label: "Film or media production studio", note: "soundstage + office" },
    { emoji: "📦", label: "Warehouse with showroom",    note: "hybrid retail-industrial" },
  ],
};

// Adjustments based on previous use
function previousUseBoosts(previousUse: string | null): SuitedUse[] {
  if (!previousUse) return [];
  const boosts: Record<string, SuitedUse[]> = {
    "Restaurant": [
      { emoji: "👻", label: "Ghost kitchen or delivery hub", note: "kitchen infrastructure already in place" },
      { emoji: "🍻", label: "Bar or brewery",               note: "ventilation & plumbing shortcut" },
    ],
    "Grocery / market": [
      { emoji: "🥗", label: "Food co-op or community fridge", note: "refrigeration infrastructure" },
      { emoji: "🌮", label: "Food hall with multiple vendors", note: "wide open floor for stalls" },
    ],
    "Hotel / lodging": [
      { emoji: "🏡", label: "Co-living or short-term rental", note: "rooms already subdivided" },
      { emoji: "🧘", label: "Wellness retreat or spa",         note: "rooms → treatment spaces" },
    ],
    "Industrial": [
      { emoji: "🎉", label: "Event or wedding venue",         note: "raw industrial aesthetic" },
      { emoji: "🌱", label: "Urban farm or vertical garden",  note: "large floor plate, skylights" },
    ],
    "Religious / community": [
      { emoji: "🎭", label: "Community theater or arts venue",note: "assembly space & acoustics" },
      { emoji: "🏫", label: "Charter school or learning center", note: "existing assembly use" },
    ],
    "Office": [
      { emoji: "🏠", label: "Live-work lofts",               note: "office → residential conversion trend" },
      { emoji: "🎓", label: "Education or tutoring center",   note: "classroom-ready rooms" },
    ],
  };
  return boosts[previousUse] ?? [];
}

// Size adjustments: remove suggestions that don't fit, add size-specific ones
function sizeAdjust(uses: SuitedUse[], size: SizeCategory, sqft: number | null): SuitedUse[] {
  // Remove clearly oversized suggestions for micro/small spaces
  const oversized = new Set(["Food hall or market hall", "Large fitness center", "Warehouse brewery or taproom", "Music venue or live events"]);
  const undersized = new Set(["Boutique hotel", "Cinema or screening room", "Fulfillment or last-mile hub"]);

  return uses.filter((u) => {
    if ((size === "micro" || size === "small") && oversized.has(u.label)) return false;
    if ((size === "micro" || size === "small") && undersized.has(u.label)) return false;
    return true;
  });
}

/**
 * Returns up to 6 suited-for suggestions for a space, ordered by best fit.
 * Combines zone-based suggestions with previous-use boosts.
 */
export function getSuitedUses(
  zoningCode: string | null | undefined,
  previousUse: string | null | undefined,
  squareFeet: number | null | undefined
): SuitedUse[] {
  const size = sizeCategory(squareFeet);
  const zoneBase = zoningCode ? (ZONE_USES[zoningCode.toUpperCase()] ?? []) : [];
  const boosts = previousUseBoosts(previousUse ?? null);

  // Boosts go first (they're most relevant given the physical layout)
  const combined = [...boosts, ...zoneBase];

  // Deduplicate by label
  const seen = new Set<string>();
  const deduped = combined.filter((u) => {
    if (seen.has(u.label)) return false;
    seen.add(u.label);
    return true;
  });

  return sizeAdjust(deduped, size, squareFeet ?? null).slice(0, 6);
}

// ---------------------------------------------------------------------------
// Size label
// ---------------------------------------------------------------------------

export function getSizeLabel(sqft: number | null | undefined): string {
  const size = sizeCategory(sqft);
  const labels: Record<SizeCategory, string> = {
    micro:  "Micro (under 1,000 sq ft)",
    small:  "Small",
    medium: "Mid-size",
    large:  "Large",
    anchor: "Anchor-scale",
  };
  return labels[size];
}
