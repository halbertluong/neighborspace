"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { IdeaForm } from "@/components/IdeaForm";
import { ThemeList } from "@/components/ThemeList";
import { PledgeForm } from "@/components/PledgeForm";
import { SpacePhoto } from "@/components/SpacePhoto";
import { getZoneInfo } from "@/lib/zones";
import { getPastUseInfo, getSuitedUses, type SuitedUse } from "@/lib/spaceInsights";

type Idea = {
  id: string;
  title: string;
  description: string;
  category: string;
  feasibilityStatus: string;
  themeId: string | null;
  createdAt: string;
};

type Theme = {
  id: string;
  name: string;
  description: string | null;
  _count: { votes: number; ideas: number };
  ideas: Idea[];
};

type SpaceDetail = {
  id: string;
  name: string;
  address: string;
  neighborhood: string;
  city: string;
  squareFeet: number | null;
  zoningCode: string | null;
  previousUse: string | null;
  imageUrl: string | null;
  lat: number;
  lng: number;
  portlandMapsId: string | null;
  ideas: Idea[];
  themes: Theme[];
  totalPledgedCents: number;
};

const TABS = [
  { id: "ideas"  as const, emoji: "💡", label: "Dream",  sub: "Share ideas"    },
  { id: "themes" as const, emoji: "🗳️", label: "Vote",   sub: "Pick favorites" },
  { id: "pledge" as const, emoji: "🤝", label: "Pledge", sub: "Show support"   },
];

function portlandMapsUrl(address: string, portlandMapsId: string | null): string {
  if (portlandMapsId) {
    const slug = address.replace(/\//g, "").replace(/\s+/g, "-").replace(/-+/g, "-").trim();
    return `https://www.portlandmaps.com/detail/property/${slug}/${portlandMapsId}_did/?search=${encodeURIComponent(address)}`;
  }
  return `https://www.portlandmaps.com/?search=${encodeURIComponent(address)}`;
}

function FeasibilityBadge({ status }: { status: string }) {
  if (status === "feasible")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Feasible
      </span>
    );
  if (status === "not_feasible")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
        Not feasible
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-500">
      <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />
      Under review
    </span>
  );
}

function SuitedUseChip({ use }: { use: SuitedUse }) {
  return (
    <div
      className="flex items-start gap-2 rounded-2xl bg-stone-50 px-3 py-2.5 ring-1 ring-stone-100"
      title={use.note}
    >
      <span className="text-lg leading-none">{use.emoji}</span>
      <div>
        <p className="text-sm font-medium text-stone-800 leading-tight">{use.label}</p>
        {use.note && <p className="text-[11px] text-stone-400 mt-0.5">{use.note}</p>}
      </div>
    </div>
  );
}

export default function SpaceDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const [space, setSpace] = useState<SpaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"ideas" | "themes" | "pledge">("ideas");

  const fetchSpace = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`/api/spaces/${id}`);
    if (res.ok) setSpace(await res.json());
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchSpace(); }, [fetchSpace]);

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="shimmer h-64 w-full rounded-3xl" />
        <div className="mt-4 space-y-3">
          <div className="shimmer h-6 w-2/3 rounded-xl" />
          <div className="shimmer h-4 w-1/2 rounded-lg" />
        </div>
      </main>
    );
  }

  if (!space) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8 text-center">
        <p className="text-stone-500">Space not found.</p>
        <Link href="/" className="mt-3 inline-block text-emerald-600 hover:underline font-medium">
          ← Back to map
        </Link>
      </main>
    );
  }

  const totalPledged = (space.totalPledgedCents || 0) / 100;
  const pastUse  = getPastUseInfo(space.previousUse);
  const suited   = getSuitedUses(space.zoningCode, space.previousUse, space.squareFeet);
  const zoneInfo = getZoneInfo(space.zoningCode);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 pb-safe">
      {/* Back nav */}
      <Link
        href="/"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 hover:text-stone-900 transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
        </svg>
        All spaces
      </Link>

      {/* Hero photo */}
      <div className="overflow-hidden rounded-3xl bg-stone-100 shadow-sm ring-1 ring-stone-200">
        <div className="relative h-64 sm:h-80">
          <SpacePhoto
            spaceId={space.id}
            imageUrl={space.imageUrl}
            lat={space.lat}
            lng={space.lng}
            alt={space.name}
            size="large"
            className="h-full w-full"
          />
          <a
            href={`https://maps.google.com/?q=${space.lat},${space.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-stone-800 shadow-md backdrop-blur-sm hover:bg-white transition-colors"
          >
            <svg className="h-3.5 w-3.5 text-emerald-600" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
            Open in Google Maps
          </a>
        </div>
      </div>

      {/* Space info card */}
      <div className="mt-4 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
        <h1 className="text-2xl font-bold text-stone-900">{space.name}</h1>
        <p className="mt-1 text-stone-500">
          {space.address}{space.neighborhood ? ` · ${space.neighborhood}` : ""}
        </p>

        {/* Quick-stat badges */}
        <div className="mt-4 flex flex-wrap gap-2">
          {space.squareFeet != null && (
            <span className="rounded-full bg-stone-100 px-3 py-1 text-sm font-medium text-stone-700">
              📐 {space.squareFeet.toLocaleString()} sq ft
            </span>
          )}
          {space.zoningCode && (
            <span
              className="rounded-full bg-stone-100 px-3 py-1 text-sm font-medium text-stone-700"
              title={zoneInfo?.description}
            >
              🏙️ {zoneInfo ? `${space.zoningCode} — ${zoneInfo.label}` : `Zone ${space.zoningCode}`}
            </span>
          )}
          {space.previousUse && (
            <span className="rounded-full bg-stone-100 px-3 py-1 text-sm font-medium text-stone-700">
              🏪 Formerly {space.previousUse.toLowerCase()}
            </span>
          )}
        </div>

        {/* Source / contact row */}
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-stone-50 px-3 py-2.5 ring-1 ring-stone-100">
          <span className="text-[11px] text-stone-400">Source:</span>
          <a
            href="https://www.portlandmaps.com/od/index.cfm?action=DataCatalog"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-medium text-stone-500 hover:text-stone-700 hover:underline"
          >
            Portland Open Data
          </a>
          <span className="ml-auto">
            <a
              href={portlandMapsUrl(space.address, space.portlandMapsId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600 ring-1 ring-blue-200 hover:bg-blue-100 transition-colors"
            >
              Contact property owner ↗
            </a>
          </span>
        </div>

        {/* Community stats */}
        <div className="mt-5 flex gap-4 border-t border-stone-100 pt-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-stone-900">{space.ideas.length}</p>
            <p className="text-xs text-stone-500">ideas shared</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-stone-900">{space.themes.length}</p>
            <p className="text-xs text-stone-500">themes</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-emerald-600">
              ${totalPledged > 0 ? totalPledged.toLocaleString() : "0"}
            </p>
            <p className="text-xs text-stone-500">pledged</p>
          </div>
        </div>
      </div>

      {/* Past use + assets */}
      {pastUse && (
        <div className="mt-4 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
          <h2 className="text-base font-bold text-stone-900">{pastUse.headline}</h2>
          <p className="mt-2 text-sm text-stone-600 leading-relaxed">{pastUse.body}</p>

          {pastUse.assets.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 mb-2">
                Likely assets still present
              </p>
              <div className="flex flex-wrap gap-1.5">
                {pastUse.assets.map((asset) => (
                  <span
                    key={asset}
                    className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-100"
                  >
                    {asset}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Suited-for suggestions */}
      {suited.length > 0 && (
        <div className="mt-4 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
          <h2 className="text-base font-bold text-stone-900">This space could be great for…</h2>
          {zoneInfo && (
            <p className="mt-1 text-sm text-stone-400">
              Based on {space.zoningCode} zoning ({zoneInfo.label})
              {space.squareFeet ? ` and its ${space.squareFeet.toLocaleString()} sq ft footprint` : ""}
              {space.previousUse ? ` and its history as ${space.previousUse.toLowerCase()}` : ""}.
            </p>
          )}
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {suited.map((use) => (
              <SuitedUseChip key={use.label} use={use} />
            ))}
          </div>
        </div>
      )}

      {/* Phase tabs */}
      <div className="mt-6 grid grid-cols-3 gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-2xl p-3 text-left transition-all ${
              activeTab === tab.id
                ? "bg-emerald-600 text-white shadow-sm"
                : "bg-white text-stone-700 ring-1 ring-stone-200 hover:ring-emerald-300"
            }`}
          >
            <span className="text-xl">{tab.emoji}</span>
            <p className="mt-1 font-semibold text-sm">{tab.label}</p>
            <p className={`text-xs ${activeTab === tab.id ? "text-emerald-100" : "text-stone-400"}`}>
              {tab.sub}
            </p>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mt-4">
        {activeTab === "ideas" && (
          <div className="space-y-4">
            <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
              <h2 className="text-lg font-bold text-stone-900">What would you love here?</h2>
              <p className="mt-1 mb-4 text-sm text-stone-500">
                Share your dream for this space. Ideas are checked against zoning and size automatically.
              </p>
              <IdeaForm spaceId={space.id} spaceSqft={space.squareFeet} spaceZoning={space.zoningCode} onSuccess={fetchSpace} />
            </div>

            {space.ideas.length > 0 && (
              <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
                <h2 className="text-base font-bold text-stone-900 mb-4">
                  Community ideas
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-sm font-semibold text-amber-700">
                    {space.ideas.length}
                  </span>
                </h2>
                <ul className="space-y-3">
                  {space.ideas.map((idea) => (
                    <li key={idea.id} className="rounded-2xl bg-stone-50 p-4 ring-1 ring-stone-100">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-stone-900">{idea.title}</p>
                        <FeasibilityBadge status={idea.feasibilityStatus} />
                      </div>
                      <p className="mt-1 text-sm text-stone-600">{idea.description}</p>
                      <span className="mt-2 inline-block rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-stone-600 ring-1 ring-stone-200">
                        {idea.category}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {activeTab === "themes" && (
          <div>
            <div className="mb-4 rounded-3xl bg-amber-50 p-4 ring-1 ring-amber-100">
              <p className="text-sm font-medium text-amber-800">
                🗳️ Group similar ideas into themes, then vote for the ones you love most.
              </p>
            </div>
            <ThemeList
              spaceId={space.id}
              themes={space.themes}
              ideas={space.ideas}
              onUpdate={fetchSpace}
            />
          </div>
        )}

        {activeTab === "pledge" && (
          <div className="space-y-4">
            <div className="rounded-3xl bg-emerald-50 p-6 ring-1 ring-emerald-100">
              <p className="text-sm text-emerald-700 font-medium">
                🤝 Pledge the gift card amount you'd spend when this business opens. This data goes directly to potential business owners so they know the community is ready.
              </p>
              <p className="mt-4 text-4xl font-bold text-emerald-700">
                ${totalPledged.toLocaleString()}
              </p>
              <p className="text-sm text-emerald-600">total pledged so far</p>
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
              <h2 className="text-lg font-bold text-stone-900 mb-1">Pledge your support</h2>
              <p className="mb-4 text-sm text-stone-500">
                How much would you spend in gift cards here on opening day?
              </p>
              <PledgeForm spaceId={space.id} themes={space.themes} onSuccess={fetchSpace} />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
