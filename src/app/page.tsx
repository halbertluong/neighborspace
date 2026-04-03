"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { SpaceMarker, MapBounds, SpaceMapHandle } from "@/components/SpaceMap";
import { SpacePhoto } from "@/components/SpacePhoto";
import { getZoneLabel, getZoneInfo, zoneBadgeClass, ZONE_INFO } from "@/lib/zones";

const SpaceMap = dynamic(() => import("@/components/SpaceMap"), { ssr: false });

// ─── Types ───────────────────────────────────────────────────────────────────
type Space = {
  id: string;
  name: string;
  address: string;
  neighborhood: string;
  squareFeet: number | null;
  zoningCode: string | null;
  previousUse: string | null;
  imageUrl: string | null;
  lat: number;
  lng: number;
  occupancyStatus: string | null;
  portlandMapsId: string | null;
  portlandMapsLinkAddress: string | null;
  _count: { ideas: number; themes: number };
};

type ListResponse = {
  spaces: Space[];
  total: number;
  page: number;
  pages: number;
};

// ─── Portland Maps URL helper ────────────────────────────────────────────────
function portlandMapsUrl(address: string, portlandMapsId: string | null, linkAddress?: string | null): string {
  if (portlandMapsId) {
    const addrForUrl = linkAddress ?? address;
    const slug = addrForUrl.replace(/\//g, "").replace(/\s+/g, "-").replace(/-+/g, "-").trim();
    return `https://www.portlandmaps.com/detail/property/${slug}/${portlandMapsId}_did/?search=${encodeURIComponent(addrForUrl)}`;
  }
  return `https://www.portlandmaps.com/?search=${encodeURIComponent(address)}`;
}

// ─── Badge ───────────────────────────────────────────────────────────────────
function ZoneBadge({ code }: { code: string | null | undefined }) {
  if (!code) return null;
  const info = getZoneInfo(code);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${zoneBadgeClass(code)}`}
      title={info?.description}
    >
      {info?.label ?? code}
    </span>
  );
}

// ─── Space card ──────────────────────────────────────────────────────────────
function SpaceCard({ space, selected, onHover }: {
  space: Space;
  selected: boolean;
  onHover: (id: string | null) => void;
}) {
  const router = useRouter();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/spaces/${space.id}`)}
      onKeyDown={(e) => e.key === "Enter" && router.push(`/spaces/${space.id}`)}
      onMouseEnter={() => onHover(space.id)}
      onMouseLeave={() => onHover(null)}
      className={`group cursor-pointer overflow-hidden rounded-2xl bg-white ring-1 transition-all duration-150 ${
        selected ? "shadow-md ring-emerald-400" : "ring-stone-200 hover:shadow-md hover:ring-emerald-300"
      }`}
    >
      <div className="relative h-36 w-full overflow-hidden bg-stone-100">
        <SpacePhoto spaceId={space.id} imageUrl={space.imageUrl} lat={space.lat} lng={space.lng} alt={space.name} size="thumb" className="h-full w-full" />
        {(space._count.ideas > 0 || space._count.themes > 0) && (
          <div className="absolute left-2 top-2 flex gap-1">
            {space._count.ideas > 0 && (
              <span className="rounded-full bg-amber-400/90 px-2 py-0.5 text-[10px] font-bold text-amber-950 backdrop-blur-sm">
                {space._count.ideas} ideas
              </span>
            )}
            {space._count.themes > 0 && (
              <span className="rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
                {space._count.themes} themes
              </span>
            )}
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-semibold text-stone-900 leading-tight">{space.name}</p>
        <p className="mt-0.5 truncate text-xs text-stone-500">{space.address}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <ZoneBadge code={space.zoningCode} />
          {space.previousUse && (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-500 ring-1 ring-stone-200">
              was {space.previousUse}
            </span>
          )}
          {space.squareFeet && (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-500 ring-1 ring-stone-200">
              {space.squareFeet.toLocaleString()} ft²
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-emerald-600 group-hover:text-emerald-700">Dream about it →</p>
          <a
            href={portlandMapsUrl(space.address, space.portlandMapsId, space.portlandMapsLinkAddress)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 text-[11px] font-medium text-blue-500 hover:text-blue-700 hover:underline"
            title="View property owner, permits, and contact info on Portland Maps"
          >
            Contact owner ↗
          </a>
        </div>
        <div className="mt-1.5 flex items-center gap-1 border-t border-stone-100 pt-1.5">
          <span className="text-[10px] text-stone-300">Source:</span>
          <a
            href="https://www.portlandmaps.com/od/index.cfm?action=DataCatalog"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] text-stone-400 hover:text-stone-600 hover:underline"
          >
            Portland Open Data
          </a>
          {space.occupancyStatus === "likely_vacant" ? (
            <span className="ml-auto rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 ring-1 ring-emerald-200">
              Likely vacant
            </span>
          ) : space.occupancyStatus === "occupied" ? (
            <span className="ml-auto text-[10px] italic text-stone-400">May be occupied</span>
          ) : (
            <span className="ml-auto text-[10px] italic text-amber-500">Occupancy unknown</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Mobile space card (Zillow-style, larger) ────────────────────────────────
function MobileSpaceCard({ space, selected }: { space: Space; selected: boolean }) {
  const router = useRouter();
  const sqft = space.squareFeet;
  const sqftLabel = sqft ? (sqft >= 1000 ? `${(sqft / 1000).toFixed(1)}k ft²` : `${sqft} ft²`) : null;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/spaces/${space.id}`)}
      onKeyDown={(e) => e.key === "Enter" && router.push(`/spaces/${space.id}`)}
      className={`overflow-hidden rounded-2xl bg-white ring-1 transition-all active:scale-[0.98] ${
        selected ? "ring-emerald-400 shadow-md" : "ring-stone-200 shadow-sm"
      }`}
    >
      <div className="relative h-44 w-full overflow-hidden bg-stone-100">
        <SpacePhoto spaceId={space.id} imageUrl={space.imageUrl} lat={space.lat} lng={space.lng} alt={space.name} size="thumb" className="h-full w-full object-cover" />
        {space.occupancyStatus === "likely_vacant" && (
          <span className="absolute left-3 top-3 rounded-full bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-white shadow">
            Likely vacant
          </span>
        )}
        {(space._count.ideas > 0 || space._count.themes > 0) && (
          <div className="absolute right-3 top-3 flex gap-1">
            {space._count.ideas > 0 && (
              <span className="rounded-full bg-amber-400/90 px-2 py-0.5 text-[10px] font-bold text-amber-950 backdrop-blur-sm">
                {space._count.ideas} 💡
              </span>
            )}
            {space._count.themes > 0 && (
              <span className="rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
                {space._count.themes} 🗳️
              </span>
            )}
          </div>
        )}
      </div>
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-base font-bold leading-tight text-stone-900">{space.name}</p>
            <p className="mt-0.5 truncate text-sm text-stone-500">{space.address}</p>
          </div>
          {sqftLabel && <p className="flex-shrink-0 text-sm font-semibold text-stone-700">{sqftLabel}</p>}
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <ZoneBadge code={space.zoningCode} />
          {space.previousUse && <span className="text-xs text-stone-400">was {space.previousUse.toLowerCase()}</span>}
          <span className="ml-auto text-sm font-semibold text-emerald-600">Dream it →</span>
        </div>
      </div>
    </div>
  );
}

// ─── Filter pill button ───────────────────────────────────────────────────────
function FilterPill({ active, onClick, children, className = "" }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
        active ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"
      } ${className}`}
    >
      {children}
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Home() {
  // Filter state
  const [filterZone, setFilterZone] = useState("");
  const [filterFormerly, setFilterFormerly] = useState("");
  const [filterNeighborhoods, setFilterNeighborhoods] = useState<string[]>([]);
  const [filterSqft, setFilterSqft] = useState("");
  const [excludeOffices, setExcludeOffices] = useState(true);
  const [onlyVacant, setOnlyVacant] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Map + selection state
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSpaceDetail, setSelectedSpaceDetail] = useState<Space | null>(null);
  const [mobileView, setMobileView] = useState<"map" | "list">("map");

  // Mobile bottom sheet
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const touchStartY = useRef(0);
  const touchStartExpanded = useRef(false);
  const PEEK_HEIGHT = 172; // px visible when collapsed

  // Map markers (lightweight — fetched once per filter change)
  const [markers, setMarkers] = useState<SpaceMarker[]>([]);
  const [markersLoading, setMarkersLoading] = useState(true);

  // Paginated list
  const [listItems, setListItems] = useState<Space[]>([]);
  const [listMeta, setListMeta] = useState<{ total: number; page: number; pages: number } | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Filter option sets derived from markers
  const [filterOptions, setFilterOptions] = useState<{
    zones: string[]; formerlyOptions: string[]; neighborhoods: string[];
  }>({ zones: [], formerlyOptions: [], neighborhoods: [] });

  const listRef        = useRef<HTMLDivElement>(null); // mobile sheet list
  const desktopListRef = useRef<HTMLDivElement>(null); // desktop sidebar list
  const mapRef         = useRef<SpaceMapHandle>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const sentinelRef    = useRef<HTMLDivElement>(null);
  const isInitialMarkersLoad = useRef(true);

  // ── Build marker query params ─────────────────────────────────────────────
  const markerParams = useMemo(() => {
    const p = new URLSearchParams();
    if (filterZone)     p.set("zone", filterZone);
    if (filterFormerly) p.set("formerly", filterFormerly);
    filterNeighborhoods.forEach((n) => p.append("neighborhood", n));
    if (filterSqft)     p.set("sqft", filterSqft);
    if (excludeOffices) p.set("excludeOffices", "1");
    if (onlyVacant)     p.set("onlyVacant", "1");
    return p.toString();
  }, [filterZone, filterFormerly, filterNeighborhoods, filterSqft, excludeOffices, onlyVacant]);

  // ── Build list query params ───────────────────────────────────────────────
  const listParams = useCallback((page: number) => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    if (filterZone)     p.set("zone", filterZone);
    if (filterFormerly) p.set("formerly", filterFormerly);
    filterNeighborhoods.forEach((n) => p.append("neighborhood", n));
    if (filterSqft)     p.set("sqft", filterSqft);
    if (excludeOffices) p.set("excludeOffices", "1");
    if (onlyVacant)     p.set("onlyVacant", "1");
    if (mapBounds) {
      p.set("north", String(mapBounds.north));
      p.set("south", String(mapBounds.south));
      p.set("east",  String(mapBounds.east));
      p.set("west",  String(mapBounds.west));
    }
    return p.toString();
  }, [filterZone, filterFormerly, filterNeighborhoods, filterSqft, excludeOffices, onlyVacant, mapBounds]);

  // ── Fetch markers whenever attribute filters change ───────────────────────
  useEffect(() => {
    setMarkersLoading(true);
    fetch(`/api/spaces/markers?${markerParams}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: SpaceMarker[]) => {
        const m = Array.isArray(data) ? data : [];
        setMarkers(m);
        setMarkersLoading(false);
        // Fit map to filtered results (skip initial load and very large sets)
        if (!isInitialMarkersLoad.current && m.length > 0 && m.length < 5000) {
          mapRef.current?.fitToSpaces(m);
        }
        isInitialMarkersLoad.current = false;
      })
      .catch(() => { setMarkers([]); setMarkersLoading(false); isInitialMarkersLoad.current = false; });
  }, [markerParams]);

  // ── Fetch filter options once (from a small summary query) ────────────────
  useEffect(() => {
    fetch("/api/spaces/filter-options")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setFilterOptions(data);
      });
  }, []);

  // ── Fetch first page of list when bounds or filters change ────────────────
  useEffect(() => {
    setListLoading(true);
    setListItems([]);
    fetch(`/api/spaces?${listParams(1)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: ListResponse | null) => {
        if (data) {
          setListItems(data.spaces ?? []);
          setListMeta({ total: data.total ?? 0, page: data.page ?? 1, pages: data.pages ?? 1 });
        }
        setListLoading(false);
      })
      .catch(() => setListLoading(false));
  }, [mapBounds, filterZone, filterFormerly, filterNeighborhoods, filterSqft, excludeOffices, onlyVacant]);

  // ── Load more ─────────────────────────────────────────────────────────────
  const loadMore = useCallback(() => {
    if (!listMeta || listMeta.page >= listMeta.pages || loadingMore) return;
    const nextPage = listMeta.page + 1;
    setLoadingMore(true);
    fetch(`/api/spaces?${listParams(nextPage)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: ListResponse | null) => {
        if (data) {
          setListItems((prev) => [...prev, ...(data.spaces ?? [])]);
          setListMeta({ total: data.total ?? 0, page: data.page ?? 1, pages: data.pages ?? 1 });
        }
        setLoadingMore(false);
      })
      .catch(() => setLoadingMore(false));
  }, [listMeta, loadingMore, listParams]);

  // ── When a marker is selected, show its card in the list ─────────────────
  useEffect(() => {
    if (!selectedId) {
      setSelectedSpaceDetail(null);
      return;
    }

    // Check if the card is already in the current page of results
    const found = listItems.find((s) => s.id === selectedId);
    if (found) {
      setSelectedSpaceDetail(null);
      setTimeout(() => {
        // Scroll whichever list is active
        [listRef, desktopListRef].forEach((ref) => {
          ref.current?.querySelector(`[data-id="${selectedId}"]`)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }, 150);
      return;
    }

    // Not in current list page — fetch the space by ID and pin it at top
    fetch(`/api/spaces/${selectedId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data?.id) return;
        setSelectedSpaceDetail({
          id:              data.id,
          name:            data.name,
          address:         data.address,
          neighborhood:    data.neighborhood     ?? "",
          squareFeet:      data.squareFeet       ?? null,
          zoningCode:      data.zoningCode       ?? null,
          previousUse:     data.previousUse      ?? null,
          imageUrl:        data.imageUrl         ?? null,
          lat:             data.lat,
          lng:             data.lng,
          occupancyStatus: data.occupancyStatus  ?? null,
          portlandMapsId:          data.portlandMapsId          ?? null,
          portlandMapsLinkAddress: data.portlandMapsLinkAddress  ?? null,
          _count: {
            ideas:  (data.ideas  ?? []).length,
            themes: (data.themes ?? []).length,
          },
        });
        setTimeout(() => {
          listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
          desktopListRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        }, 150);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ── Close filter panel on outside click / touch ──────────────────────────
  useEffect(() => {
    if (!filtersOpen) return;
    function handle(e: MouseEvent | TouchEvent) {
      const target = "touches" in e ? e.touches[0]?.target : (e as MouseEvent).target;
      if (filterPanelRef.current && !filterPanelRef.current.contains(target as Node)) {
        setFiltersOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    document.addEventListener("touchstart", handle as EventListener, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("touchstart", handle as EventListener);
    };
  }, [filtersOpen]);

  // ── Infinite scroll sentinel ──────────────────────────────────────────────
  const loadMoreRef = useRef(loadMore);
  useEffect(() => { loadMoreRef.current = loadMore; }, [loadMore]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = listRef.current;
    if (!sentinel || !container) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMoreRef.current(); },
      { root: container, rootMargin: "120px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount once — loadMore accessed via ref

  const handleBoundsChange = useCallback((bounds: MapBounds) => {
    setMapBounds(bounds);
  }, []);

  const activeFilters = [filterZone, filterFormerly, filterSqft].filter(Boolean).length
    + (filterNeighborhoods.length > 0 ? 1 : 0)
    + (excludeOffices ? 1 : 0)
    + (onlyVacant ? 1 : 0);

  const { zones, formerlyOptions, neighborhoods } = filterOptions;
  const displayFormerlyOptions = formerlyOptions.filter((u) => !(excludeOffices && u === "Office"));

  return (
    <div className="relative flex h-[calc(100dvh-56px)] flex-col overflow-hidden lg:flex-row">

      {/* ── MOBILE LAYOUT — full-screen map + bottom sheet ────────────── */}
      <div className="relative flex-1 lg:hidden">

        {/* Full-screen map */}
        <SpaceMap
          ref={mapRef}
          spaces={markers}
          selectedId={selectedId}
          onSelect={(id) => { setSelectedId(id); setSheetExpanded(false); }}
          onBoundsChange={handleBoundsChange}
          className="absolute inset-0 h-full w-full"
        />

        {/* Floating top bar */}
        <div className="pointer-events-none absolute left-3 right-3 top-3 z-20 flex items-center gap-2">
          <div className="pointer-events-auto flex-1 rounded-2xl bg-white/95 px-4 py-2.5 shadow-lg backdrop-blur-sm">
            <p className="text-sm font-semibold text-stone-800">
              {listLoading ? "Loading…" : `${(listMeta?.total ?? markers.length).toLocaleString()} spaces`}
              {activeFilters > 0 && <span className="ml-1.5 text-xs font-medium text-emerald-600">· {activeFilters} filter{activeFilters !== 1 ? "s" : ""}</span>}
            </p>
          </div>
          <button
            onClick={() => setFiltersOpen(true)}
            className={`pointer-events-auto flex items-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-lg backdrop-blur-sm ${
              activeFilters > 0 ? "bg-emerald-600 text-white" : "bg-white/95 text-stone-700"
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
            </svg>
            {activeFilters > 0 ? `${activeFilters}` : "Filters"}
          </button>
        </div>

        {/* Selected-space preview card (Zillow-style) */}
        {selectedId && (
          <div
            className="absolute left-3 right-3 z-20 sheet-transition"
            style={{ bottom: PEEK_HEIGHT + 12 }}
          >
            {(() => {
              const sp = selectedSpaceDetail ?? listItems.find((s) => s.id === selectedId);
              if (!sp) return null;
              return (
                <div
                  className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-xl"
                >
                  <a href={`/spaces/${sp.id}`} className="contents">
                    <div className="h-16 w-20 flex-shrink-0 overflow-hidden rounded-xl bg-stone-100">
                      <SpacePhoto spaceId={sp.id} imageUrl={sp.imageUrl} lat={sp.lat} lng={sp.lng} alt={sp.name} size="thumb" className="h-full w-full object-cover" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-stone-900">{sp.name}</p>
                      <p className="truncate text-xs text-stone-500">{sp.address}</p>
                      {sp.squareFeet && <p className="mt-0.5 text-xs font-medium text-stone-600">{sp.squareFeet.toLocaleString()} ft²</p>}
                    </div>
                    <span className="flex-shrink-0 text-xs font-semibold text-emerald-600">Open →</span>
                  </a>
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSelectedId(null); }}
                    className="-mr-1 flex-shrink-0 rounded-full p-1.5 text-stone-400 hover:bg-stone-100"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              );
            })()}
          </div>
        )}

        {/* Bottom sheet */}
        <div
          className="absolute bottom-0 left-0 right-0 z-20 flex flex-col rounded-t-3xl bg-white shadow-2xl sheet-transition"
          style={{
            height: "calc(100% - 56px)",
            transform: sheetExpanded ? "translateY(0)" : `translateY(calc(100% - ${PEEK_HEIGHT}px))`,
          }}
          onTouchStart={(e) => { touchStartY.current = e.touches[0].clientY; touchStartExpanded.current = sheetExpanded; }}
          onTouchEnd={(e) => {
            const delta = touchStartY.current - e.changedTouches[0].clientY;
            if (delta > 40) setSheetExpanded(true);
            else if (delta < -40) setSheetExpanded(false);
          }}
        >
          {/* Drag handle + count */}
          <div
            className="flex-shrink-0 cursor-pointer select-none px-4 pb-2 pt-3"
            onClick={() => setSheetExpanded((v) => !v)}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-300" />
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-stone-900">
                {listLoading ? "Loading…" : `${(listMeta?.total ?? 0).toLocaleString()} spaces`}
              </p>
              <p className="text-xs text-stone-400">{sheetExpanded ? "Swipe down ↓" : "Swipe up ↑"}</p>
            </div>
          </div>

          {/* Scrollable card list */}
          <div ref={listRef} className="sheet-scroll flex-1 overflow-y-auto px-4 pb-safe">
            {listLoading && listItems.length === 0 ? (
              <div className="space-y-4 pt-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
                    <div className="shimmer h-44 w-full" />
                    <div className="space-y-2 p-4">
                      <div className="shimmer h-5 w-3/4 rounded" />
                      <div className="shimmer h-4 w-1/2 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : listItems.length === 0 && !listLoading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <div className="text-4xl">🗺️</div>
                <p className="text-base font-semibold text-stone-600">No spaces in this view</p>
                <p className="text-sm text-stone-400">Pan the map or clear filters</p>
                {activeFilters > 0 && (
                  <button onClick={() => { setFilterZone(""); setFilterFormerly(""); setFilterNeighborhoods([]); setFilterSqft(""); setExcludeOffices(false); setOnlyVacant(false); }} className="mt-1 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-4 pt-2">
                {selectedSpaceDetail && (
                  <div>
                    <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-600">Selected</p>
                    <MobileSpaceCard space={selectedSpaceDetail} selected={true} />
                  </div>
                )}
                {listItems.map((space) => (
                  <div key={space.id} data-id={space.id}>
                    <MobileSpaceCard space={space} selected={selectedId === space.id} />
                  </div>
                ))}
                {listMeta && listMeta.page < listMeta.pages ? (
                  <div ref={sentinelRef} className="py-6 text-center text-xs text-stone-400">
                    {loadingMore ? "Loading more…" : ""}
                  </div>
                ) : listMeta && listItems.length > 0 ? (
                  <p className="py-6 text-center text-xs text-stone-400">All {(listMeta.total ?? 0).toLocaleString()} spaces loaded</p>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── FILTER PANEL — bottom sheet on mobile, dropdown on desktop ─── */}
      {filtersOpen && (
        <div
          ref={filterPanelRef}
          className="fixed inset-0 z-50 lg:absolute lg:inset-auto lg:left-0 lg:right-auto lg:top-[57px] lg:w-[400px]"
        >
          {/* Mobile backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm lg:hidden" onClick={() => setFiltersOpen(false)} />
          {/* Panel */}
          <div className="absolute bottom-0 left-0 right-0 flex max-h-[88vh] flex-col rounded-t-3xl bg-white shadow-2xl lg:static lg:max-h-none lg:rounded-none lg:shadow-none lg:border-b lg:border-stone-200"
        >
            {/* Mobile-only header */}
          <div className="flex flex-shrink-0 items-center justify-between border-b border-stone-100 px-5 py-4 lg:hidden">
            <h2 className="text-lg font-bold text-stone-900">Filters</h2>
            {activeFilters > 0 && (
              <button onClick={() => { setFilterZone(""); setFilterFormerly(""); setFilterNeighborhoods([]); setFilterSqft(""); setExcludeOffices(false); setOnlyVacant(false); }} className="text-sm font-medium text-red-500">Clear all</button>
            )}
          </div>

          <div className="sheet-scroll flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-4 lg:max-h-[55vh]">

              {/* Only likely vacant toggle */}
              <button
                onClick={() => setOnlyVacant((o) => !o)}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium ring-1 transition-colors ${
                  onlyVacant ? "bg-emerald-700 text-white ring-emerald-700" : "bg-white text-stone-600 ring-stone-200 hover:ring-stone-400"
                }`}
              >
                <span className="flex items-center gap-2"><span>🏚️</span> Only likely vacant</span>
                <span className={`h-4 w-7 rounded-full transition-colors ${onlyVacant ? "bg-emerald-300" : "bg-stone-200"}`}>
                  <span className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${onlyVacant ? "translate-x-3" : "translate-x-0"}`} />
                </span>
              </button>

              {/* Exclude offices toggle */}
              <button
                onClick={() => setExcludeOffices((o) => !o)}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium ring-1 transition-colors ${
                  excludeOffices ? "bg-stone-900 text-white ring-stone-900" : "bg-white text-stone-600 ring-stone-200 hover:ring-stone-400"
                }`}
              >
                <span className="flex items-center gap-2"><span>🏢</span> Hide office spaces</span>
                <span className={`h-4 w-7 rounded-full transition-colors ${excludeOffices ? "bg-emerald-400" : "bg-stone-200"}`}>
                  <span className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${excludeOffices ? "translate-x-3" : "translate-x-0"}`} />
                </span>
              </button>

              {/* Neighborhood — multi-select */}
              {neighborhoods.length > 0 && (
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-stone-400">
                    Neighborhood{filterNeighborhoods.length > 0 ? ` · ${filterNeighborhoods.length} selected` : ""}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <FilterPill active={filterNeighborhoods.length === 0} onClick={() => setFilterNeighborhoods([])}>All</FilterPill>
                    {neighborhoods.map((nb) => (
                      <FilterPill key={nb} active={filterNeighborhoods.includes(nb)} onClick={() => {
                        setFilterNeighborhoods((prev) =>
                          prev.includes(nb) ? prev.filter((n) => n !== nb) : [...prev, nb]
                        );
                      }}>{nb}</FilterPill>
                    ))}
                  </div>
                </div>
              )}

              {/* Size */}
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-stone-400">Size</p>
                <div className="flex flex-wrap gap-1.5">
                  <FilterPill active={filterSqft === ""} onClick={() => setFilterSqft("")}>Any size</FilterPill>
                  <FilterPill active={filterSqft === "small"} onClick={() => setFilterSqft(filterSqft === "small" ? "" : "small")}>{"< 2k ft²"}</FilterPill>
                  <FilterPill active={filterSqft === "medium"} onClick={() => setFilterSqft(filterSqft === "medium" ? "" : "medium")}>2k–5k ft²</FilterPill>
                  <FilterPill active={filterSqft === "large"} onClick={() => setFilterSqft(filterSqft === "large" ? "" : "large")}>5k–15k ft²</FilterPill>
                  <FilterPill active={filterSqft === "huge"} onClick={() => setFilterSqft(filterSqft === "huge" ? "" : "huge")}>15k+ ft²</FilterPill>
                </div>
              </div>

              {/* Zone */}
              {zones.length > 0 && (
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-stone-400">Zoning</p>
                  <div className="flex flex-wrap gap-1.5">
                    <FilterPill active={filterZone === ""} onClick={() => setFilterZone("")}>All</FilterPill>
                    {zones.map((code) => (
                      <button
                        key={code}
                        title={ZONE_INFO[code]?.description}
                        onClick={() => setFilterZone(filterZone === code ? "" : code)}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-all ${
                          filterZone === code ? `${zoneBadgeClass(code)} font-semibold` : "bg-white text-stone-600 ring-stone-200 hover:ring-stone-400"
                        }`}
                      >
                        {getZoneLabel(code)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Formerly */}
              {displayFormerlyOptions.length > 0 && (
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-stone-400">Was formerly</p>
                  <div className="flex flex-wrap gap-1.5">
                    <FilterPill active={filterFormerly === ""} onClick={() => setFilterFormerly("")}>All</FilterPill>
                    {displayFormerlyOptions.map((use) => (
                      <FilterPill key={use} active={filterFormerly === use} onClick={() => {
                        setFilterFormerly(filterFormerly === use ? "" : use);
                      }}>{use}</FilterPill>
                    ))}
                  </div>
                </div>
              )}

              {/* Clear */}
              <div className="flex items-center justify-between pt-1">
                {activeFilters > 0 && (
                  <button
                    onClick={() => {
                      setFilterZone(""); setFilterFormerly(""); setFilterNeighborhoods([]); setFilterSqft(""); setExcludeOffices(false); setOnlyVacant(false);
                    }}
                    className="text-xs font-medium text-red-500 hover:text-red-600"
                  >
                    × Clear {activeFilters} filter{activeFilters !== 1 ? "s" : ""}
                  </button>
                )}
                <button onClick={() => setFiltersOpen(false)} className="ml-auto text-xs font-medium text-stone-400 hover:text-stone-600 lg:block hidden">
                  Done
                </button>
              </div>
            </div>
          {/* Mobile-only show results button */}
          <div className="flex-shrink-0 border-t border-stone-100 px-5 py-4 pb-safe lg:hidden">
            <button onClick={() => setFiltersOpen(false)} className="w-full rounded-2xl bg-stone-900 py-3.5 text-sm font-bold text-white">
              Show {(listMeta?.total ?? markers.length).toLocaleString()} spaces
            </button>
          </div>
          </div>
        </div>
      )}

      {/* ── DESKTOP MAP ─────────────────────────────────────────────────── */}
      <div className="relative hidden flex-shrink-0 lg:order-2 lg:flex lg:flex-1">
        <SpaceMap
          ref={mapRef}
          spaces={markers}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
          onBoundsChange={handleBoundsChange}
          className="h-full w-full"
        />
      </div>

      {/* ── DESKTOP LEFT PANEL ──────────────────────────────────────────── */}
      <aside className="hidden w-full flex-col bg-white lg:order-1 lg:flex lg:w-[400px] lg:flex-shrink-0 lg:border-r lg:border-stone-200">

        {/* Desktop-only sticky header */}
        <div className="hidden flex-shrink-0 border-b border-stone-100 bg-white px-4 py-3 lg:block">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-base font-bold text-stone-900">What should open here?</h1>
              <p className="text-xs text-stone-400 truncate">
                {listLoading ? "Loading…" : listMeta
                  ? <><span className="font-semibold text-emerald-600">{(listMeta.total ?? 0).toLocaleString()}</span>{" spaces in view"}</>
                  : <><span className="font-semibold text-emerald-600">{(markers.length ?? 0).toLocaleString()}</span>{" spaces"}</>
                }
              </p>
            </div>
            <button
              onClick={() => setFiltersOpen((o) => !o)}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
                filtersOpen || activeFilters > 0
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200"
              }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
              </svg>
              Filters{activeFilters > 0 ? ` · ${activeFilters}` : ""}
            </button>
          </div>
        </div>

        {/* ── Scrollable card list ────────────────────────────────────── */}
        <div ref={desktopListRef} className="flex-1 overflow-y-auto p-4 pb-safe">
          {listLoading && listItems.length === 0 && !selectedSpaceDetail ? (
            <div className="space-y-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
                  <div className="shimmer h-36 w-full" />
                  <div className="space-y-2 p-3">
                    <div className="shimmer h-4 w-3/4 rounded" />
                    <div className="shimmer h-3 w-1/2 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : listItems.length === 0 && !listLoading && !selectedSpaceDetail ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="text-3xl">🗺️</div>
              <p className="text-sm font-medium text-stone-500">No spaces in this view</p>
              <p className="text-xs text-stone-400">Pan or zoom the map, or clear filters</p>
              {activeFilters > 0 && (
                <button
                  onClick={() => { setFilterZone(""); setFilterFormerly(""); setFilterNeighborhoods([]); setFilterSqft(""); setExcludeOffices(false); }}
                  className="mt-1 text-xs font-medium text-emerald-600 hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Selected space pinned at top when it's not in current page */}
              {selectedSpaceDetail && (
                <div>
                  <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-600">
                    Selected
                  </p>
                  <div data-id={selectedSpaceDetail.id}>
                    <SpaceCard space={selectedSpaceDetail} selected={true} onHover={() => {}} />
                  </div>
                </div>
              )}

              {listItems.map((space) => (
                <div key={space.id} data-id={space.id}>
                  <SpaceCard space={space} selected={selectedId === space.id} onHover={setSelectedId} />
                </div>
              ))}

              {/* Infinite scroll sentinel */}
              {listMeta && listMeta.page < listMeta.pages ? (
                <div ref={sentinelRef} className="py-4 text-center text-xs text-stone-400">
                  {loadingMore ? "Loading…" : ""}
                </div>
              ) : listMeta && listItems.length > 0 ? (
                <p className="py-4 text-center text-xs text-stone-400">
                  All {(listMeta.total ?? 0).toLocaleString()} spaces loaded
                </p>
              ) : null}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
