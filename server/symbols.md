# v1 symbol list

Starting with 15 pairs instead of "all of Binance" on purpose:

- Every extra symbol is another open WebSocket subscription + ongoing Postgres
  writes, even if nobody's watching it. Free-tier Railway compute is not
  unlimited.
- Your actual audience (beginner/underfunded traders) mostly trades majors and
  a handful of momentum coins — long-tail altcoins add cost without adding
  users.
- Easy to expand later: adding a symbol is one row in `symbols` + one relay
  subscription, not a schema change.

## Seed list (majors + high-retail-interest alts)

```sql
INSERT INTO symbols (pair, display) VALUES
  ('BTCUSDT',  'BTC/USDT'),
  ('ETHUSDT',  'ETH/USDT'),
  ('SOLUSDT',  'SOL/USDT'),
  ('BNBUSDT',  'BNB/USDT'),
  ('XRPUSDT',  'XRP/USDT'),
  ('DOGEUSDT', 'DOGE/USDT'),
  ('ADAUSDT',  'ADA/USDT'),
  ('AVAXUSDT', 'AVAX/USDT'),
  ('LINKUSDT', 'LINK/USDT'),
  ('MATICUSDT','MATIC/USDT'),
  ('DOTUSDT',  'DOT/USDT'),
  ('LTCUSDT',  'LTC/USDT'),
  ('TRXUSDT',  'TRX/USDT'),
  ('SHIBUSDT', 'SHIB/USDT'),
  ('PEPEUSDT', 'PEPE/USDT')
ON CONFLICT (pair) DO NOTHING;
```

## Timeframes tracked per symbol

Start with `1m, 15m, 1h, 4h, 1d` — five Binance kline streams per symbol
(75 total WebSocket subscriptions for 15 symbols). Skip `5m`/`30m`/`1w` for
v1; add only if users ask.
