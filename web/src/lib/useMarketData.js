// Real market data hook — replaces the simulated candle generator from the
// UI concept. Loads historical candles via REST, then layers live updates
// from the WebSocket on top. One WebSocket connection persists across
// symbol/timeframe changes; only the subscription changes.

import { useEffect, useRef, useState, useCallback } from "react";
import { fetchCandles } from "./api.js";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001/ws";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export function useMarketData(symbol, timeframe) {
  const [candles, setCandles] = useState([]);
  const [whaleEvents, setWhaleEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef(null);
  const currentChannelRef = useRef(null);
  // The connect effect below only runs once (empty deps — intentional, so
  // we don't tear down and reopen the socket on every symbol/timeframe
  // change). That means its onmessage closure would otherwise capture
  // `symbol`/`timeframe` from the very first render and never see updates.
  // These refs are kept in sync on every change so onmessage always reads
  // the live values instead of a stale closure.
  const symbolRef = useRef(symbol);
  const timeframeRef = useRef(timeframe);
  useEffect(() => {
    symbolRef.current = symbol;
    timeframeRef.current = timeframe;
  }, [symbol, timeframe]);

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
    let reconnectAttempt = 0;

    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        reconnectAttempt = 0; // reset backoff after a successful connection
        setConnected(true);
        subscribeToChannel(symbolRef.current, timeframeRef.current);
      };

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (msg.type === "candle" && msg.symbol === symbolRef.current && msg.timeframe === timeframeRef.current) {
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

        if (msg.type === "whale" && msg.symbol === symbolRef.current) {
          const id = `${msg.event.hash || msg.event.from || "unknown"}-${Date.now()}`;
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
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
        reconnectAttempt += 1;
        setTimeout(connect, delay);
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
