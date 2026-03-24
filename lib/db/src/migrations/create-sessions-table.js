import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(__dirname, "sessions.sql"), "utf-8");

try {
  await pool.query(sql);
  console.log("Sessions table created (or already exists).");
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error("Failed to create sessions table:", err);
  await pool.end();
  process.exit(1);
}
