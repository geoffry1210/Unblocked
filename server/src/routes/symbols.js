// GET /symbols
// Returns the list of actively tracked pairs so the frontend can populate
// the symbol search and watchlist without hardcoding the list client-side.

import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT pair, display FROM symbols WHERE active = true ORDER BY pair"
    );
    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch symbols", err);
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
