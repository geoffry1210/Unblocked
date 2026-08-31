-- Unblocked — Phase 0 schema
-- Run with: psql $DATABASE_URL -f schema.sql

-- Which pairs the relay tracks. Seeded with the v1 symbol list (see symbols.md).
CREATE TABLE IF NOT EXISTS symbols (
  id          SERIAL PRIMARY KEY,
  pair        TEXT NOT NULL UNIQUE,       -- e.g. 'BTCUSDT' (Binance format, no slash)
  display     TEXT NOT NULL,              -- e.g. 'BTC/USDT'
  exchange    TEXT NOT NULL DEFAULT 'binance',
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per closed candle. Composite key prevents duplicate writes on relay restart.
CREATE TABLE IF NOT EXISTS candles (
  symbol      TEXT NOT NULL,              -- matches symbols.pair
  timeframe   TEXT NOT NULL,              -- '1m','15m','1h','4h','1d'
  open_time   TIMESTAMPTZ NOT NULL,
  open        NUMERIC NOT NULL,
  high        NUMERIC NOT NULL,
  low         NUMERIC NOT NULL,
  close       NUMERIC NOT NULL,
  volume      NUMERIC NOT NULL,
  PRIMARY KEY (symbol, timeframe, open_time)
);

-- Fast range queries: "give me the last N candles for symbol+timeframe"
CREATE INDEX IF NOT EXISTS idx_candles_symbol_tf_time
  ON candles (symbol, timeframe, open_time DESC);

-- Phase 3: whale/wallet events from CoinRadar, rendered as chart pulse markers.
-- Kept in this schema now so Phase 3 is a feed-in, not a migration.
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
