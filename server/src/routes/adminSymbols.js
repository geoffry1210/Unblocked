// POST /internal/symbols/sync — discovers all USDT/USD/USDC pairs across
// the live exchanges and upserts them into the symbols table. Fire-and-
// forget, same reasoning as /internal/backfill/run: runs on Render's own
// network so it isn't at the mercy of a phone's connection, and returns
// immediately while the actual work continues server-side.
//
// After this completes, the live relay needs a restart to pick up the
// expanded symbol list (it only reads active symbols once, at startup) —
// trigger a redeploy, then run /internal/backfill/run for the newly added
// pairs.
//
// Reuses the same BACKFILL_SECRET as the backfill endpoint — one shared
// "internal admin" secret rather than a second one to manage.

import { Router } from "express";
import { syncSymbols } from "../services/symbolSync.js";

const router = Router();

let state = { running: false, startedAt: null, finishedAt: null, log: [], result: null };

function requireSecret(req, res, next) {
  const provided = req.headers["x-backfill-key"];
  if (!process.env.BACKFILL_SECRET) {
    return res.status(500).json({ error: "BACKFILL_SECRET is not set on the server" });
  }
  if (provided !== process.env.BACKFILL_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

router.post("/sync", requireSecret, (_req, res) => {
  if (state.running) {
    return res.status(409).json({ error: "a sync is already running", state });
  }

  state = { running: true, startedAt: new Date().toISOString(), finishedAt: null, log: [], result: null };

  syncSymbols({
    onProgress: (line) => {
      console.log(`[symbolSync] ${line}`);
      state.log.push(line);
      if (state.log.length > 100) state.log.shift();
    },
  })
    .then((result) => {
      state.result = result;
    })
    .catch((err) => {
      state.log.push(`CRASHED: ${err.message}`);
    })
    .finally(() => {
      state.running = false;
      state.finishedAt = new Date().toISOString();
    });

  res.json({ started: true });
});

router.get("/status", requireSecret, (_req, res) => {
  res.json(state);
});

export default router;
