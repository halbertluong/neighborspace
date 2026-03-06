"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  CATEGORY_HEX, CATEGORY_LABEL, getHexForUse, type SpaceTypeCategory,
} from "@/lib/spaceTypes";

export type SpaceMarker = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  previousUse?: string | null;
  ideaCount?: number;
  themeCount?: number;
};

export type MapBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type SpaceMapHandle = {
  fitToSpaces: (spaces: { lat: number; lng: number }[]) => void;
};

// ── Legend ────────────────────────────────────────────────────────────────────
const LEGEND_CATS: SpaceTypeCategory[] = [
  "food", "retail", "office", "industrial", "community", "commercial", "general",
];

function MapLegend() {
  return (
    <div className="pointer-events-none absolute bottom-10 left-2 z-[400] rounded-lg bg-white/90 px-2.5 py-2 shadow-md backdrop-blur-sm ring-1 ring-stone-200">
      <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-stone-400">
        Previous use
      </p>
      <div className="space-y-1">
        {LEGEND_CATS.map((cat) => (
          <div key={cat} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
              style={{ background: CATEGORY_HEX[cat] }}
            />
            <span className="text-[10px] leading-none text-stone-600">
              {CATEGORY_LABEL[cat]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Marker style helpers ───────────────────────────────────────────────────────
function markerStyle(previousUse: string | null | undefined, isSelected: boolean) {
  const baseColor = getHexForUse(previousUse);
  return {
    radius:      isSelected ? 9 : 5,
    fillColor:   isSelected ? "#059669" : baseColor,
    color:       "rgba(255,255,255,0.9)",
    weight:      isSelected ? 2.5 : 1.5,
    fillOpacity: isSelected ? 1 : 0.85,
    opacity:     1,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────
const SpaceMap = forwardRef<SpaceMapHandle, {
  spaces: SpaceMarker[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  onBoundsChange?: (bounds: MapBounds) => void;
  className?: string;
}>(function SpaceMap({
  spaces,
  selectedId,
  onSelect,
  onBoundsChange,
  className = "h-80 w-full",
}, ref) {
  const containerRef     = useRef<HTMLDivElement>(null);
  const mapRef           = useRef<L.Map | null>(null);
  const canvasRef        = useRef<L.Canvas | null>(null);
  const markersRef       = useRef<Map<string, L.CircleMarker>>(new Map());
  const prevSelectedRef  = useRef<string | null>(null);
  const onSelectRef      = useRef(onSelect);
  const onBoundsChangeRef = useRef(onBoundsChange);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onBoundsChangeRef.current = onBoundsChange; }, [onBoundsChange]);

  useImperativeHandle(ref, () => ({
    fitToSpaces(spaces) {
      const map = mapRef.current;
      if (!map || spaces.length === 0) return;
      if (spaces.length === 1) {
        map.flyTo([spaces[0].lat, spaces[0].lng], 15, { duration: 0.8 });
      } else {
        const bounds = L.latLngBounds(spaces.map((s) => [s.lat, s.lng] as [number, number]));
        map.flyToBounds(bounds, { padding: [48, 48], duration: 0.8, maxZoom: 16 });
      }
    },
  }), []);

  // ── Init map ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mounted || !containerRef.current || mapRef.current) return;

    canvasRef.current = L.canvas({ padding: 0.5 });

    const map = L.map(containerRef.current, {
      zoomControl: false,
      preferCanvas: true,
    }).setView([45.5731, -122.7068], 13);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);

    const reportBounds = () => {
      const b = map.getBounds();
      onBoundsChangeRef.current?.({
        north: b.getNorth(), south: b.getSouth(),
        east:  b.getEast(),  west:  b.getWest(),
      });
    };

    map.on("moveend", reportBounds);
    map.on("zoomend", reportBounds);
    setTimeout(reportBounds, 300);

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; canvasRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  // ── Sync markers when spaces list changes ─────────────────────────────────
  // Only adds/removes markers. Selection styling is handled in the next effect.
  useEffect(() => {
    const map    = mapRef.current;
    const canvas = canvasRef.current;
    if (!map || !canvas) return;

    const currentIds = new Set(spaces.map((s) => s.id));

    // Remove stale markers
    for (const [id, marker] of markersRef.current) {
      if (!currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    // Add new markers (always with unselected style — selection effect runs next)
    for (const s of spaces) {
      if (!markersRef.current.has(s.id)) {
        const style = markerStyle(s.previousUse, false);
        const cm = L.circleMarker([s.lat, s.lng], { renderer: canvas, ...style })
          .on("click", () => onSelectRef.current(s.id))
          .addTo(map);

        const useLabel = s.previousUse
          ? `<span style="font-size:10px;color:#888">${s.previousUse}</span><br>`
          : "";
        cm.bindTooltip(
          `<strong style="font-size:12px">${s.name}</strong><br>${useLabel}<span style="font-size:11px;color:#666">${s.address}</span>`,
          { direction: "top", offset: [0, -8] },
        );
        markersRef.current.set(s.id, cm);
      }
    }

    // Reset so the selection effect re-applies the selected style
    prevSelectedRef.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaces]);

  // ── Sync selection — only touches 2 markers ───────────────────────────────
  useEffect(() => {
    const prev = prevSelectedRef.current;
    if (prev === (selectedId ?? null)) return;

    // Deselect previous
    if (prev) {
      const cm = markersRef.current.get(prev);
      if (cm) {
        const space = spaces.find((s) => s.id === prev);
        const style = markerStyle(space?.previousUse, false);
        cm.setStyle(style);
        cm.setRadius(style.radius);
      }
    }

    // Select new
    if (selectedId) {
      const cm = markersRef.current.get(selectedId);
      if (cm) {
        const space = spaces.find((s) => s.id === selectedId);
        const style = markerStyle(space?.previousUse, true);
        cm.setStyle(style);
        cm.setRadius(style.radius);
      }
    }

    prevSelectedRef.current = selectedId ?? null;
  }, [selectedId, spaces]);

  if (!mounted) {
    return <div className={`${className} shimmer`} />;
  }

  return (
    <div className={`${className} relative`}>
      <div ref={containerRef} className="absolute inset-0" />
      <MapLegend />
    </div>
  );
});

export default SpaceMap;
