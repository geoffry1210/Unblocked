import { useState } from "react";
import { Landing } from "./components/Landing.jsx";
import { AppShell } from "./components/AppShell.jsx";

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&family=Manrope:wght@400;500;600;700&display=swap');`;

export default function App() {
  const [view, setView] = useState("landing");
  return (
    <div style={{ width: "100%", height: "100vh", background: "#0B0E11", fontFamily: "'Manrope', sans-serif" }}>
      <style>{`
        ${FONT_IMPORT}
        * { box-sizing: border-box; }
        body { margin: 0; }
        @keyframes whalePulse {
          0% { box-shadow: 0 0 0 0 rgba(124,92,255,0.55); transform: scale(1); }
          70% { box-shadow: 0 0 0 16px rgba(124,92,255,0); transform: scale(1.15); }
          100% { box-shadow: 0 0 0 0 rgba(124,92,255,0); transform: scale(1); }
        }
      `}</style>
      {view === "landing" ? (
        <Landing onLaunch={() => setView("app")} />
      ) : (
        <AppShell onBack={() => setView("landing")} />
      )}
    </div>
  );
}
