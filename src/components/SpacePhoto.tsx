"use client";

import { useState } from "react";

type ImgSource = "custom" | "streetview" | "mapillary";
type AnySource = ImgSource | "satellite" | "none";

type SpacePhotoProps = {
  spaceId: string;
  imageUrl?: string | null;
  lat: number;
  lng: number;
  alt: string;
  className?: string;
  size?: "thumb" | "large";
};

export function SpacePhoto({
  spaceId,
  imageUrl,
  lat,
  lng,
  alt,
  className = "",
  size = "thumb",
}: SpacePhotoProps) {
  const firstImgSource: ImgSource = imageUrl ? "custom" : "streetview";
  const [source, setSource] = useState<AnySource>(firstImgSource);
  const [loaded, setLoaded] = useState(false);

  const imgSrcs: Record<ImgSource, string> = {
    custom: imageUrl ?? "",
    streetview: `/api/spaces/${spaceId}/streetview`,
    mapillary: `/api/spaces/${spaceId}/mapillary`,
  };

  function advance() {
    setLoaded(false);
    setSource((prev) => {
      if (prev === "custom") return "streetview";
      if (prev === "streetview") return "mapillary";
      if (prev === "mapillary") return "satellite";
      return "none";
    });
  }

  const mapsEmbedUrl =
    `https://maps.google.com/maps?q=${lat},${lng}&t=k&z=18&output=embed`;
  const mapsOpenUrl =
    `https://maps.google.com/?q=${lat},${lng}`;

  const heightClass = size === "large" ? "h-full min-h-[240px]" : "h-full min-h-[160px]";

  // ── Google Maps satellite embed (free, no API key) ──────────────────────
  if (source === "satellite") {
    return (
      <div className={`relative overflow-hidden bg-stone-100 ${heightClass} ${className}`}>
        <iframe
          src={mapsEmbedUrl}
          title={`Satellite view of ${alt}`}
          className="h-full w-full border-0"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
        {/* Overlay badge */}
        <div className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          Satellite view
        </div>
      </div>
    );
  }

  // ── No photo at all ──────────────────────────────────────────────────────
  if (source === "none") {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 bg-stone-100 ${heightClass} ${className}`}>
        <svg className="h-8 w-8 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
        </svg>
        <a
          href={mapsOpenUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
        >
          View on Google Maps →
        </a>
      </div>
    );
  }

  // ── Image sources (custom / streetview / mapillary) ──────────────────────
  return (
    <div className={`relative overflow-hidden bg-stone-100 ${heightClass} ${className}`}>
      {!loaded && <div className="shimmer absolute inset-0" />}
      <img
        key={source}
        src={imgSrcs[source as ImgSource]}
        alt={alt}
        className={`h-full w-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        onLoad={() => setLoaded(true)}
        onError={advance}
      />
    </div>
  );
}
