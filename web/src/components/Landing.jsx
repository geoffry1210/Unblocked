import { useEffect, useState } from "react";

function GlitchPrice() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPhase((p) => (p + 1) % 3), 1800);
    return () => clearInterval(id);
  }, []);
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <span style={{ textDecoration: phase >= 1 ? "line-through" : "none", textDecorationColor: "#FF5C77", textDecorationThickness: "3px", color: phase >= 2 ? "#4A5063" : "#E8EAED", transition: "color 300ms ease" }}>
        $29.99/mo
      </span>
      <span style={{ marginLeft: 14, color: "#F5B700", opacity: phase >= 2 ? 1 : 0, transform: phase >= 2 ? "translateY(0)" : "translateY(4px)", transition: "all 350ms ease", fontWeight: 800 }}>
        $0 forever
      </span>
    </span>
  );
}

export function Landing({ onLaunch }) {
  return (
    <div style={{ position: "relative", minHeight: "100%", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, opacity: 0.16, background: "radial-gradient(ellipse at 20% 0%, rgba(124,92,255,0.35), transparent 55%), radial-gradient(ellipse at 85% 20%, rgba(245,183,0,0.25), transparent 50%)" }} />
      <nav style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 32px", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 26, height: 26, background: "linear-gradient(135deg,#F5B700,#7C5CFF)", borderRadius: 6 }} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, letterSpacing: 1, color: "#E8EAED" }}>UNBLOCKED</span>
        </div>
        <button onClick={onLaunch} style={{ background: "transparent", border: "1px solid #2A3140", color: "#E8EAED", padding: "9px 18px", borderRadius: 8, fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
          Launch App →
        </button>
      </nav>
      <div style={{ position: "relative", padding: "72px 32px 40px", maxWidth: 720 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#7C5CFF", letterSpacing: 2, marginBottom: 18 }}>
          &gt; NO ACCOUNT. NO PAYWALL. NO CATCH.
        </div>
        <h1 style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 44, fontWeight: 800, color: "#E8EAED", lineHeight: 1.15, margin: 0 }}>
          Charts this good<br />shouldn't cost <GlitchPrice />
        </h1>
        <p style={{ fontFamily: "'Manrope', sans-serif", fontSize: 16, color: "#8B93A3", marginTop: 22, maxWidth: 480, lineHeight: 1.6 }}>
          Unlimited indicators, live whale-wallet alerts on the chart itself, every timeframe you need. Built for traders who are just getting started — not for the ones who can already afford Pro.
        </p>
        <button onClick={onLaunch} style={{ marginTop: 30, background: "#F5B700", color: "#0B0E11", border: "none", padding: "14px 26px", borderRadius: 8, fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
          Start charting free
        </button>
        <div style={{ display: "flex", gap: 22, marginTop: 56, flexWrap: "wrap" }}>
          {[
            ["Unlimited indicators", "No 2-per-chart cap. Stack RSI, MACD, Bollinger, whatever you need."],
            ["Whale alerts on-chart", "See large wallet moves pulse directly on the price timeline."],
            ["Every timeframe, free", "1m to 1D, no upsell to unlock the ones that matter."],
          ].map(([t, d]) => (
            <div key={t} style={{ flex: "1 1 180px", minWidth: 180 }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 14, color: "#E8EAED", marginBottom: 6 }}>{t}</div>
              <div style={{ fontFamily: "'Manrope', sans-serif", fontSize: 13, color: "#8B93A3", lineHeight: 1.5 }}>{d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
