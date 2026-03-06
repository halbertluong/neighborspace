"use client";

import { useState } from "react";

type Idea = {
  id: string;
  title: string;
  description: string;
  category: string;
  themeId: string | null;
};

type Theme = {
  id: string;
  name: string;
  description: string | null;
  _count: { votes: number; ideas: number };
  ideas: Idea[];
};

const inputClass =
  "rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-100 transition-all";

export function ThemeList({
  spaceId,
  themes,
  ideas,
  onUpdate,
}: {
  spaceId: string;
  themes: Theme[];
  ideas: Idea[];
  onUpdate: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [votingId, setVotingId] = useState<string | null>(null);

  async function handleCreateTheme(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/themes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined }),
      });
      if (res.ok) { setName(""); setDescription(""); onUpdate(); }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVote(themeId: string) {
    setVotingId(themeId);
    try {
      const res = await fetch(`/api/themes/${themeId}/vote`, { method: "POST" });
      if (res.ok) onUpdate();
    } finally {
      setVotingId(null);
    }
  }

  const maxVotes = Math.max(...themes.map((t) => t._count.votes), 1);

  return (
    <div className="space-y-4">
      {/* Vote on themes */}
      {themes.length > 0 && (
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
          <h2 className="text-base font-bold text-stone-900 mb-1">Vote for your favorites</h2>
          <p className="text-sm text-stone-500 mb-4">
            Tap a theme to vote. You can vote for any theme — pick the ones that excite you most.
          </p>
          <ul className="space-y-3">
            {themes
              .slice()
              .sort((a, b) => b._count.votes - a._count.votes)
              .map((theme) => {
                const pct = Math.round((theme._count.votes / maxVotes) * 100);
                return (
                  <li key={theme.id} className="rounded-2xl bg-stone-50 p-4 ring-1 ring-stone-100">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-stone-900">{theme.name}</p>
                        {theme.description && (
                          <p className="mt-0.5 text-sm text-stone-500">{theme.description}</p>
                        )}
                        {/* Vote bar */}
                        <div className="mt-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-stone-500">
                              {theme._count.votes} vote{theme._count.votes !== 1 ? "s" : ""}
                              {theme._count.ideas > 0 && ` · ${theme._count.ideas} idea${theme._count.ideas !== 1 ? "s" : ""}`}
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200">
                            <div
                              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        {theme.ideas.length > 0 && (
                          <ul className="mt-2 flex flex-wrap gap-1.5">
                            {theme.ideas.map((i) => (
                              <li key={i.id} className="rounded-full bg-white px-2 py-0.5 text-xs text-stone-500 ring-1 ring-stone-200">
                                {i.title}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleVote(theme.id)}
                        disabled={votingId === theme.id}
                        className="flex-shrink-0 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                      >
                        {votingId === theme.id ? "…" : "👍 Vote"}
                      </button>
                    </div>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

      {/* Create theme */}
      <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
        <h2 className="text-base font-bold text-stone-900 mb-1">
          {themes.length === 0 ? "Create the first theme" : "Add a new theme"}
        </h2>
        <p className="text-sm text-stone-500 mb-4">
          Group similar ideas into a theme (e.g. &quot;Cozy café&quot;) so neighbors can vote on it.
        </p>
        <form onSubmit={handleCreateTheme} className="space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Theme name, e.g. Neighborhood café"
            className={`w-full ${inputClass}`}
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description (optional)"
            className={`w-full ${inputClass}`}
          />
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Creating…" : "Create theme"}
          </button>
        </form>
      </div>

      {/* Assign unassigned ideas */}
      {ideas.some((i) => !i.themeId) && themes.length > 0 && (
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
          <h2 className="text-base font-bold text-stone-900 mb-1">Assign ideas to a theme</h2>
          <p className="text-sm text-stone-500 mb-4">
            Link unassigned ideas to a theme so they show up for voting.
          </p>
          <ul className="space-y-2">
            {ideas.filter((i) => !i.themeId).map((idea) => (
              <li key={idea.id} className="flex items-center gap-3">
                <span className="flex-1 truncate text-sm text-stone-700 font-medium">{idea.title}</span>
                <select
                  className="rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5 text-xs text-stone-700 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                  defaultValue=""
                  onChange={async (e) => {
                    const themeId = e.target.value || null;
                    await fetch(`/api/ideas/${idea.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ themeId }),
                    });
                    onUpdate();
                  }}
                >
                  <option value="">— assign —</option>
                  {themes.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
