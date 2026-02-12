import React, { useMemo, useState } from "react";
import Button from "./Button.jsx";

const MOCK_RESULTS = [
  {
    file: "Employee_Contract.pdf",
    location: "Page 12, Paragraph 3",
    snippet: "Termination may occur with immediate effect if the employee breaches...",
  },
  {
    file: "Policy.docx",
    location: "Section 4.2, Paragraph 5",
    snippet: "All confidential information must remain within the organization...",
  },
];

export default function SearchPanel({ files }) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("exact"); // exact | context
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);

  const canSearch = useMemo(() => query.trim().length > 0 && files.length > 0, [query, files]);

  async function handleSearch() {
  setLoading(true);
  setResults([]);

  try {
    const token = localStorage.getItem("auth_token");
    const res = await fetch("/api/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, mode }), // mode: "exact" | "context"
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      // show backend error in UI
      setResults([]);
      console.error(data?.error || "Search failed");
      setLoading(false);
      return;
    }

    setResults(data.results || []);
  } catch (e) {
    console.error("Search server not reachable", e);
  } finally {
    setLoading(false);
  }
}


  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-zinc-900">Search</div>
          <div className="text-xs text-zinc-500">Ask for a word, sentence, or context</div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode("exact")}
            className={[
              "rounded-xl px-3 py-2 text-xs font-medium border transition",
              mode === "exact"
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50",
            ].join(" ")}
          >
            Exact
          </button>
          <button
            type="button"
            onClick={() => setMode("context")}
            className={[
              "rounded-xl px-3 py-2 text-xs font-medium border transition",
              mode === "context"
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50",
            ].join(" ")}
          >
            Context
          </button>
        </div>
      </div>

      <div className="mt-4">
        <input
          className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100"
          placeholder={mode === "exact" ? "Type a word or exact phrase..." : "Describe what you want to find..."}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSearch && !loading) handleSearch();
          }}
        />
        <div className="mt-3 flex items-center justify-between">
          <div className="text-xs text-zinc-500">
            {files.length === 0 ? "Upload files first." : "Press Enter to search."}
          </div>
          <Button onClick={handleSearch} disabled={!canSearch || loading}>
            {loading ? "Searching..." : "Search"}
          </Button>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {results.length === 0 ? (
          <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4 text-sm text-zinc-600">
            Results will show here with exact location (file + page/paragraph).
          </div>
        ) : (
          results.map((r, i) => (
            <div key={i} className="rounded-xl border border-zinc-100 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-zinc-900">{r.file}</div>
                  <div className="text-xs text-zinc-500">{r.location}</div>
                </div>
                <button type="button" className="rounded-lg px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
                  Open
                </button>
              </div>
              <div className="mt-3 text-sm text-zinc-700">{r.snippet}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
