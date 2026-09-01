// Real market data hook — replaces the simulated candle generator from the
// UI concept. Loads historical candles via REST, then layers live updates
// from the WebSocket on top. One WebSocket connection persists across
// symbol/timeframe changes; only the subscription changes.

import { useEffect, useRef, useState, useCallback } from "react";
import { fetchCandles } from "./api.js";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001/ws";
const RECONNECT_DELAY_MS = 3000;

export function useMarketData(symbol, timeframe) {
  const [candles, setCandles] = useState([]);
  const [whaleEvents, setWhaleEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef(null);
  const currentChannelRef = useRef(null);

  // Historical load — runs on every symbol/timeframe change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCandles(symbol, timeframe, 200)
      .then((data) => {
        if (!cancelled) setCandles(data);
      })
      .catch((err) => console.error("Failed to load candles", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe]);

  // WebSocket connection — opened once, kept alive across symbol/tf changes.
  useEffect(() => {
    let cancelled = false;

    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        subscribeToChannel(symbol, timeframe);
      };

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (msg.type === "candle" && msg.symbol === symbol && msg.timeframe === timeframe) {
          setCandles((prev) => {
            if (prev.length === 0) return prev;
            const incoming = {
              o: msg.candle.o,
              h: msg.candle.h,
              l: msg.candle.l,
              c: msg.candle.c,
              v: msg.candle.v,
              t: msg.candle.openTime,
            };
            const last = prev[prev.length - 1];
            if (msg.closed) {
              // Candle finished — shift window, append a fresh one
              return [...prev.slice(1), incoming];
            }
            // Still forming — update the last candle in place
            return [...prev.slice(0, -1), incoming];
          });
        }

        if (msg.type === "whale" && msg.symbol === symbol) {
          const id = `${msg.event.wallet || "unknown"}-${Date.now()}`;
          setWhaleEvents((prev) => [...prev, { ...msg.event, id }]);
          // Auto-expire after 15s so the pulse list doesn't grow forever
          setTimeout(() => {
            setWhaleEvents((prev) => prev.filter((e) => e.id !== id));
          }, 15000);
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        setTimeout(connect, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
    // Intentionally only runs once on mount — subscription changes are
    // handled separately below so we don't reopen the socket every time
    // the user switches symbols.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subscribeToChannel = useCallback((sym, tf) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    if (currentChannelRef.current) {
      const [prevSym, prevTf] = currentChannelRef.current;
      ws.send(JSON.stringify({ type: "unsubscribe", symbol: prevSym, timeframe: prevTf }));
    }
    ws.send(JSON.stringify({ type: "subscribe", symbol: sym, timeframe: tf }));
    currentChannelRef.current = [sym, tf];
  }, []);

  // Re-subscribe whenever symbol/timeframe changes (after initial connect)
  useEffect(() => {
    if (connected) subscribeToChannel(symbol, timeframe);
  }, [symbol, timeframe, connected, subscribeToChannel]);

  return { candles, whaleEvents, loading, connected };
}
