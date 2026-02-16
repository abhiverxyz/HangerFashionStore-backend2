// Prisma 7 configuration for migrations (prisma db push, migrate deploy, etc.)
// Application code uses getPrisma() from src/core/db.js with DATABASE_URL

import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, ".env") });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Set it in backend2/.env");
}

export default {
  datasource: {
    url: databaseUrl,
  },
};
