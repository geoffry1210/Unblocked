# Wiring IndicatorPicker into AppShell.jsx

This wasn't merged into AppShell.jsx directly — that file is being actively
worked on elsewhere (the drawing-toolbar restructure), so touching it here
risked a collision. Everything below is additive; none of it requires
changing how the drawing tools work.

## What's new

- `web/src/lib/indicatorCatalog.js` — the full ~90-indicator list, each
  tagged `implemented: true/false`. 35 are real (math lives in
  `indicators.js`); the rest are browsable/favoritable now and show
  "coming soon" if clicked, rather than being silently missing.
- `web/src/components/IndicatorPicker.jsx` — the search + favorites modal
  itself. Fully standalone — manages its own search/favorites state, reads
  nothing from AppShell.
- `web/src/lib/indicators.js` — 24 new indicator functions appended (Batch 2
  section at the bottom). Sanity-tested against synthetic OHLCV data for
  bounded ranges and sane behavior (ADX/DI 0-100, Williams %R -100..0,
  SuperTrend flips direction on trend reversal, etc.) — see git log for the
  test script if useful as a reference.

## Integration steps

**1. Import and render the picker**

```jsx
import { IndicatorPicker } from "./IndicatorPicker.jsx";

// inside AppShell, alongside existing useState calls:
const [pickerOpen, setPickerOpen] = useState(false);

// wherever the current indicator chip row is rendered, add a button to open it:
<button onClick={() => setPickerOpen(true)}>+ Indicators</button>

// near the end of AppShell's returned JSX:
<IndicatorPicker
  open={pickerOpen}
  onClose={() => setPickerOpen(false)}
  onSelect={(entry) => handleIndicatorSelect(entry)}
/>
```

**2. Handle selection — this is the part that isn't fully generic**

The existing `INDICATOR_DEFS` / `indicatorConfig` pattern (config, storage,
chip rendering) *is* data-driven and easy to extend — add an entry to
`INDICATOR_DEFS` keyed by the catalog `entry.fn` and it'll pick up config
storage and the settings popover for free. But the actual computation is
wired by hand in three places per indicator, not looped generically:

- the `indicators` `useMemo` block (add a line calling the new function,
  add its config deps to the dependency array)
- the `overlays` array (if `entry.type === "overlay"`)
- the `indicatorPanes` array (if `entry.type === "pane"`)

So `handleIndicatorSelect` should, for a first pass, just add the entry to
`INDICATOR_DEFS`/`indicatorConfig` and *enable* it — then whoever's in
AppShell.jsx adds the three-place wiring for that specific function,
following the exact pattern the existing 7 indicators (ma20, ema9, bb,
vwap, rsi, macd, stochrsi) already use. Copy-paste-adjust from one of
those is the fastest path per indicator; there isn't a shortcut given how
the file's currently structured. Making this fully generic (loop over
`INDICATOR_DEFS` instead of hand-wiring each) would be a good follow-up
once the toolbar restructure settles and the file isn't actively being
edited elsewhere — but that's a bigger refactor than this integration and
deliberately out of scope here.

**3. Function signatures, so the wiring is a lookup, not guesswork**

All new Batch 2 functions live in `indicators.js` and follow the file's
existing convention: functions needing only price take `closes` (array of
numbers), functions needing full OHLCV take `candles` (array of `{o,h,l,c,v,t}`,
same shape already used everywhere in this codebase). Multi-line outputs
return a plain object (e.g. `adx()` → `{ adx, plusDI, minusDI }`, matching
how `bollinger()` and `macd()` already return `{upper,lower,mid}` /
`{macdLine,signalLine,histogram}`).
