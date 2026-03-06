"use client";

import { useState } from "react";

type Theme = { id: string; name: string; description: string | null };

const inputClass =
  "mt-1 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-100 transition-all";

const PRESET_AMOUNTS = [10, 25, 50, 100];

export function PledgeForm({
  spaceId,
  themes,
  onSuccess,
}: {
  spaceId: string;
  themes: Theme[];
  onSuccess: () => void;
}) {
  const [themeId, setThemeId] = useState(themes[0]?.id ?? "");
  const [amountDollars, setAmountDollars] = useState("");
  const [pledgerName, setPledgerName] = useState("");
  const [pledgerEmail, setPledgerEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!themeId || !amountDollars || !pledgerName || !pledgerEmail) {
      setMessage({ type: "err", text: "Please fill in all fields." });
      return;
    }
    const amountCents = Math.round(parseFloat(amountDollars) * 100);
    if (amountCents < 100) {
      setMessage({ type: "err", text: "Minimum pledge is $1." });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/pledges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId, themeId, amountCents, pledgerName, pledgerEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "err", text: data.error || "Failed to pledge" });
        return;
      }
      setMessage({ type: "ok", text: "🎉 Thank you! Your pledge has been recorded." });
      setAmountDollars("");
      onSuccess();
    } catch {
      setMessage({ type: "err", text: "Network error. Please try again." });
    } finally {
      setSubmitting(false);
    }
  }

  if (themes.length === 0) {
    return (
      <div className="rounded-2xl bg-stone-50 p-4 text-center ring-1 ring-stone-100">
        <p className="text-sm text-stone-500">
          Head to the <strong>Vote</strong> tab first to create a theme, then come back to pledge.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-stone-700">Which concept would you support?</label>
        <select value={themeId} onChange={(e) => setThemeId(e.target.value)} className={inputClass}>
          {themes.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-700">Gift card amount</label>
        {/* Quick-pick presets */}
        <div className="mt-2 flex gap-2">
          {PRESET_AMOUNTS.map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => setAmountDollars(String(amt))}
              className={`flex-1 rounded-xl py-2 text-sm font-semibold transition-all ${
                amountDollars === String(amt)
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-stone-100 text-stone-700 hover:bg-stone-200"
              }`}
            >
              ${amt}
            </button>
          ))}
        </div>
        <input
          type="number"
          min="1"
          step="1"
          value={amountDollars}
          onChange={(e) => setAmountDollars(e.target.value)}
          placeholder="Or enter a custom amount"
          className={`${inputClass} mt-2`}
        />
        <p className="mt-1.5 text-xs text-stone-400">
          This is what you&apos;d spend in gift cards when a business matching this concept opens here.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-stone-700">Your name</label>
          <input value={pledgerName} onChange={(e) => setPledgerName(e.target.value)} required className={inputClass} placeholder="Jane" />
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700">Email</label>
          <input type="email" value={pledgerEmail} onChange={(e) => setPledgerEmail(e.target.value)} required className={inputClass} placeholder="jane@example.com" />
        </div>
      </div>

      {message && (
        <div className={`rounded-xl px-4 py-3 text-sm font-medium ${
          message.type === "ok"
            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
            : "bg-red-50 text-red-600 ring-1 ring-red-100"
        }`}>
          {message.text}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 transition-colors"
      >
        {submitting ? "Submitting…" : "Pledge my support 🤝"}
      </button>
    </form>
  );
}
