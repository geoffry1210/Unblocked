// Shared Postgres connection pool used by routes and the relay service.
import pg from "pg";

// Neon (and most hosted Postgres) requires SSL; local dev against
// localhost doesn't use or need it.
const isLocal = process.env.DATABASE_URL?.includes("localhost");

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

pool.on("error", (err) => {
  console.error("Unexpected Postgres pool error", err);
});
