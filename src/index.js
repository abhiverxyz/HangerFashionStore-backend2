import "dotenv/config";
import express from "express";
import cors from "cors";
import { join } from "path";
import { mkdir } from "fs/promises";
import { existsSync } from "fs";
import routes from "./routes/index.js";

const PORT = Number(process.env.PORT) || 3002;
const app = express();
const uploadsDir = join(process.cwd(), "public", "uploads");
if (!existsSync(uploadsDir)) {
  mkdir(uploadsDir, { recursive: true }).catch((e) => console.warn("[uploads] mkdir:", e.message));
}

// In development, allow the request origin so both localhost and LAN IP (e.g. 192.168.1.16:3001) work
const corsOrigin = process.env.CORS_ORIGIN;
const origin = !corsOrigin
  ? process.env.NODE_ENV === "production"
    ? "http://localhost:3001"
    : (reqOrigin, cb) => cb(null, reqOrigin || true)
  : corsOrigin.includes(",")
    ? corsOrigin.split(",").map((s) => s.trim())
    : corsOrigin;
app.use(cors({ origin, credentials: true }));
// Allow large payloads for import-public-payload (e.g. hundreds of products)
app.use(express.json({ limit: "50mb" }));

// Local uploads (when R2 is disabled)
app.use("/uploads", express.static(uploadsDir));

app.use("/api", routes);

// Catches errors from asyncHandler and any sync throws
app.use((err, _req, res, _next) => {
  console.error("[error]", err);
  const status = err.status ?? err.statusCode ?? 500;
  res.status(status).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Backend2 listening on http://localhost:${PORT}`);
});
