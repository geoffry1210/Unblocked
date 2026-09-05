import { useEffect, useMemo, useState } from "react";
import { INDICATOR_CATALOG } from "../lib/indicatorCatalog.js";

const FAVORITES_KEY = "unblocked.indicatorFavorites.v1";

function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Standalone, self-contained — does not read or write any AppShell state.
// Integration point: onSelect(catalogEntry) fires when the user picks an
// `implemented: true` entry; wire it to add that indicator using the same
// INDICATOR_DEFS pattern AppShell already uses (see INTEGRATION.md next to
// this file for the exact snippet).
export function IndicatorPicker({ open, onClose, onSelect }) {
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState(loadFavorites);

  useEffect(() => {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    } catch {
      // non-fatal — favorites just won't persist this session
    }
  }, [favorites]);

  const toggleFavorite = (id, e) => {
    e.stopPropagation();
    setFavorites((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]));
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? INDICATOR_CATALOG.filter((i) => i.label.toLowerCase().includes(q)) : INDICATOR_CATALOG;
    return [...matches].sort((a, b) => a.label.localeCompare(b.label));
  }, [query]);

  const favoriteEntries = INDICATOR_CATALOG.filter((i) => favorites.includes(i.id));

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "8vh" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#131720", border: "1px solid #2A3140", borderRadius: 10, width: "min(480px, 92vw)", maxHeight: "76vh", display: "flex", flexDirection: "column", fontFamily: "'Manrope', sans-serif" }}
      >
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #1D232F" }}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search indicators..."
            style={{ width: "100%", background: "#0B0E14", border: "1px solid #2A3140", borderRadius: 6, padding: "9px 12px", color: "#E8EAED", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, outline: "none" }}
          />
        </div>

        <div style={{ overflowY: "auto", padding: "6px 0" }}>
          {!query && favoriteEntries.length > 0 && (
            <>
              <div style={{ padding: "8px 16px 4px", fontSize: 11, color: "#4A5063", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>FAVORITES</div>
              {favoriteEntries.map((entry) => (
                <IndicatorRow key={entry.id} entry={entry} isFavorite onToggleFavorite={toggleFavorite} onSelect={onSelect} onClose={onClose} />
              ))}
              <div style={{ height: 1, background: "#1D232F", margin: "6px 0" }} />
            </>
          )}

          {filtered.length === 0 && <div style={{ padding: "20px 16px", color: "#4A5063", fontSize: 13 }}>No indicators match "{query}"</div>}

          {filtered.map((entry) => (
            <IndicatorRow key={entry.id} entry={entry} isFavorite={favorites.includes(entry.id)} onToggleFavorite={toggleFavorite} onSelect={onSelect} onClose={onClose} />
          ))}
        </div>
      </div>
    </div>
  );
}

function IndicatorRow({ entry, isFavorite, onToggleFavorite, onSelect, onClose }) {
  return (
    <div
      onClick={() => {
        if (!entry.implemented) return;
        onSelect(entry);
        onClose();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "9px 16px",
        cursor: entry.implemented ? "pointer" : "default",
        opacity: entry.implemented ? 1 : 0.45,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontSize: 13, color: "#E8EAED" }}>{entry.label}</span>
        <span style={{ fontSize: 10, color: "#4A5063", fontFamily: "'JetBrains Mono', monospace" }}>
          {entry.category}
          {!entry.implemented && " · coming soon"}
        </span>
      </div>
      <span
        onClick={(e) => onToggleFavorite(entry.id, e)}
        style={{ color: isFavorite ? "#F5B700" : "#2A3140", cursor: "pointer", fontSize: 15, padding: 4 }}
      >
        ★
      </span>
    </div>
  );
}
