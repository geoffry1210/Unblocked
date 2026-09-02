import { useEffect, useRef } from "react";

// Phase 5 — single ad slot, deliberately just one (header/footer strip),
// per the v1 decision not to let ad integration crowd the actual charting
// experience. Reads publisher/slot IDs from env so nothing is hardcoded —
// set VITE_ADSENSE_CLIENT and VITE_ADSENSE_SLOT on Render once you have a
// real AdSense (or crypto ad network) account approved. Until then this
// renders the plain placeholder strip so the footer never breaks.

const ADSENSE_CLIENT = import.meta.env.VITE_ADSENSE_CLIENT;
const ADSENSE_SLOT = import.meta.env.VITE_ADSENSE_SLOT;

export function AdSlot() {
  const insRef = useRef(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (!ADSENSE_CLIENT || !ADSENSE_SLOT || loaded.current) return;
    loaded.current = true;

    const existing = document.querySelector(`script[data-adsense-client="${ADSENSE_CLIENT}"]`);
    if (!existing) {
      const script = document.createElement("script");
      script.async = true;
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;
      script.crossOrigin = "anonymous";
      script.dataset.adsenseClient = ADSENSE_CLIENT;
      document.head.appendChild(script);
    }

    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (err) {
      console.error("AdSense push failed", err);
    }
  }, []);

  if (!ADSENSE_CLIENT || !ADSENSE_SLOT) {
    return (
      <footer style={{ borderTop: "1px solid #1D232F", padding: "8px 20px", fontFamily: "'Manrope', sans-serif", fontSize: 11, color: "#4A5063", textAlign: "center" }}>
        ad space — kept small, kept out of your way
      </footer>
    );
  }

  return (
    <footer style={{ borderTop: "1px solid #1D232F", padding: "6px 20px", textAlign: "center", minHeight: 50 }}>
      <ins
        ref={insRef}
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={ADSENSE_SLOT}
        data-ad-format="horizontal"
        data-full-width-responsive="true"
      />
    </footer>
  );
}
