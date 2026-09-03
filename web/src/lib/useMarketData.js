// Real market data hook — loads historical candles via REST, then layers
// live updates from the WebSocket on top. One WebSocket connection
// persists across symbol/timeframe/exchange changes; only the
// subscription changes.
//
// exchange/marketType are now required alongside symbol/timeframe — the
// same pair (e.g. BTCUSDT) exists on multiple exchanges and market types,
// so all four together identify which candle stream you actually want.

import { useEffect, useRef, useState, useCallback } from "react";
import { fetchCandles } from "./api.js";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001/ws";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export function useMarketData({ exchange, marketType, symbol, timeframe }) {
  const [candles, setCandles] = useState([]);
  const [whaleEvents, setWhaleEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef(null);
  const currentChannelRef = useRef(null);
  // The connect effect below only runs once (empty deps — intentional, so
  // we don't tear down and reopen the socket on every symbol/timeframe/
  // exchange change). That means its onmessage closure would otherwise
  // capture these from the very first render and never see updates. These
  // refs are kept in sync on every change so onmessage always reads the
  // live values instead of a stale closure.
  const exchangeRef = useRef(exchange);
  const marketTypeRef = useRef(marketType);
  const symbolRef = useRef(symbol);
  const timeframeRef = useRef(timeframe);
  useEffect(() => {
    exchangeRef.current = exchange;
    marketTypeRef.current = marketType;
    symbolRef.current = symbol;
    timeframeRef.current = timeframe;
  }, [exchange, marketType, symbol, timeframe]);

  // Historical load — runs on every exchange/marketType/symbol/timeframe change.
  useEffect(() => {
    if (!symbol || !exchange || !marketType) return;
    let cancelled = false;
    setLoading(true);
    setHasMore(true);
    fetchCandles(symbol, timeframe, { exchange, marketType, limit: 1000 })
      .then((data) => {
        if (!cancelled) {
          setCandles(data);
          setHasMore(data.length >= 1000); // a full page means there's likely more before it
        }
      })
      .catch((err) => console.error("Failed to load candles", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [exchange, marketType, symbol, timeframe]);

  // Pulls in another page of older candles and prepends them — call this
  // when the user pans/zooms near the left edge of what's currently loaded.
  const loadMore = useCallback(() => {
    setCandles((prev) => {
      if (loadingMore || !hasMore || prev.length === 0) return prev;
      const oldest = prev[0].t;
      setLoadingMore(true);
      fetchCandles(symbolRef.current, timeframeRef.current, {
        exchange: exchangeRef.current,
        marketType: marketTypeRef.current,
        limit: 1000,
        before: oldest,
      })
        .then((older) => {
          setHasMore(older.length >= 1000);
          if (older.length > 0) {
            setCandles((cur) => [...older, ...cur]);
          }
        })
        .catch((err) => console.error("Failed to load older candles", err))
        .finally(() => setLoadingMore(false));
      return prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMore, hasMore]);

  // WebSocket connection — opened once, kept alive across changes.
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
        subscribeToChannel(exchangeRef.current, marketTypeRef.current, symbolRef.current, timeframeRef.current);
      };

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (
          msg.type === "candle" &&
          msg.exchange === exchangeRef.current &&
          msg.marketType === marketTypeRef.current &&
          msg.symbol === symbolRef.current &&
          msg.timeframe === timeframeRef.current
        ) {
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
              // Candle finished — append a fresh one (keep full history, don't
              // shift the window off the front anymore now that pan-to-load
              // relies on the oldest loaded candle staying put).
              return [...prev, incoming];
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
    // the user switches symbols/exchanges.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subscribeToChannel = useCallback((ex, mt, sym, tf) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !sym || !ex || !mt) return;

    if (currentChannelRef.current) {
      const [prevEx, prevMt, prevSym, prevTf] = currentChannelRef.current;
      ws.send(JSON.stringify({ type: "unsubscribe", exchange: prevEx, marketType: prevMt, symbol: prevSym, timeframe: prevTf }));
    }
    ws.send(JSON.stringify({ type: "subscribe", exchange: ex, marketType: mt, symbol: sym, timeframe: tf }));
    currentChannelRef.current = [ex, mt, sym, tf];
  }, []);

  // Re-subscribe whenever exchange/marketType/symbol/timeframe changes (after initial connect)
  useEffect(() => {
    if (connected) subscribeToChannel(exchange, marketType, symbol, timeframe);
  }, [exchange, marketType, symbol, timeframe, connected, subscribeToChannel]);

  return { candles, whaleEvents, loading, loadingMore, hasMore, loadMore, connected };
}
