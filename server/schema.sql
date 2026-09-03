-- Unblocked schema (baseline, reflects the exchange/market_type migration)
-- Run with: psql $DATABASE_URL -f schema.sql
--
-- Multi-exchange note: candles are keyed by (exchange, market_type, symbol,
-- timeframe, open_time) — the same pair on different exchanges or market
-- types (e.g. BTCUSDT spot vs BTCUSDT perp) are entirely separate rows, not
-- collapsed. See server/src/services/exchanges/ for the adapter per
-- exchange, and server/src/db/candles.js for the shared upsert helper.

CREATE TABLE IF NOT EXISTS symbols (
  id          SERIAL PRIMARY KEY,
  pair        TEXT NOT NULL,              -- e.g. 'BTCUSDT' (exchange's own format)
  display     TEXT NOT NULL,              -- e.g. 'BTC/USDT'
  exchange    TEXT NOT NULL DEFAULT 'binance',
  market_type TEXT NOT NULL DEFAULT 'spot', -- 'spot' | 'perp' | 'inverse_perp'
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exchange, market_type, pair)
);

-- One row per closed candle. Composite key prevents duplicate writes on
-- relay restart, and separates the same pair across exchanges/market types.
CREATE TABLE IF NOT EXISTS candles (
  exchange    TEXT NOT NULL DEFAULT 'binance',
  market_type TEXT NOT NULL DEFAULT 'spot',
  symbol      TEXT NOT NULL,              -- matches symbols.pair
  timeframe   TEXT NOT NULL,              -- '1m','15m','1h','4h','1d'
  open_time   TIMESTAMPTZ NOT NULL,
  open        NUMERIC NOT NULL,
  high        NUMERIC NOT NULL,
  low         NUMERIC NOT NULL,
  close       NUMERIC NOT NULL,
  volume      NUMERIC NOT NULL,
  PRIMARY KEY (exchange, market_type, symbol, timeframe, open_time)
);

-- Fast range queries: "give me the last N candles for exchange+market+symbol+timeframe"
CREATE INDEX IF NOT EXISTS idx_candles_ex_mkt_symbol_tf_time
  ON candles (exchange, market_type, symbol, timeframe, open_time DESC);

-- Phase 3: whale/wallet events from CoinRadar, rendered as chart pulse
-- markers. On-chain/ticker-based, not exchange-specific.
CREATE TABLE IF NOT EXISTS whale_events (
  id          SERIAL PRIMARY KEY,
  symbol      TEXT NOT NULL,
  event_time  TIMESTAMPTZ NOT NULL,
  event_type  TEXT NOT NULL,              -- 'large_transfer','dev_wallet_reactivation', etc.
  amount_usd  NUMERIC,
  wallet      TEXT,
  source      TEXT NOT NULL DEFAULT 'coinradar',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whale_events_symbol_time
  ON whale_events (symbol, event_time DESC);
