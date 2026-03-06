"use client";

import { useState } from "react";
import { IDEA_CATEGORIES } from "@/lib/feasibility";

const inputClass =
  "mt-1 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-100 transition-all";

export function IdeaForm({
  spaceId,
  spaceSqft,
  spaceZoning,
  onSuccess,
}: {
  spaceId: string;
  spaceSqft: number | null;
  spaceZoning: string | null;
  onSuccess: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(IDEA_CATEGORIES[0] ?? "Other");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spaceId, title, description, category,
          submitterName: name || undefined,
          submitterEmail: email || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "err", text: data.error || "Failed to submit" });
        return;
      }
      setMessage({ type: "ok", text: "Idea submitted! " + (data.feasibilityMessage || "") });
      setTitle("");
      setDescription("");
      onSuccess();
    } catch {
      setMessage({ type: "err", text: "Network error. Please try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-stone-700">What&apos;s your idea?</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={120}
          className={inputClass}
          placeholder="e.g. A neighborhood coffee shop with outdoor seating"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-stone-700">Tell us more</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          rows={3}
          className={inputClass}
          placeholder="Why would this be amazing for the neighborhood?"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-stone-700">Category</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
          {IDEA_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-stone-700">Your name <span className="font-normal text-stone-400">(optional)</span></label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Jane" />
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700">Email <span className="font-normal text-stone-400">(optional)</span></label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="jane@example.com" />
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
        {submitting ? "Submitting…" : "Share my idea ✨"}
      </button>

      {/* Zoning context hint */}
      {(spaceSqft || spaceZoning) && (
        <p className="text-xs text-stone-400 text-center">
          This space is {spaceSqft ? `${spaceSqft.toLocaleString()} sq ft` : ""}
          {spaceSqft && spaceZoning ? " · " : ""}
          {spaceZoning ? `zoned ${spaceZoning}` : ""}
          {" "}— ideas are auto-checked for fit.
        </p>
      )}
    </form>
  );
}
