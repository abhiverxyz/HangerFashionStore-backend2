/**
 * Rate limiting for LLM-heavy and expensive endpoints (code review recommendation).
 * Apply to style-report, looks/analyze, look-planning to prevent abuse.
 */
import rateLimit from "express-rate-limit";

/** 15 min window, 10 requests per IP for style report and look planning. */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_STYLE_REPORT = 10;
const MAX_LOOK_PLANNING = 10;
const MAX_LOOKS_ANALYZE = 15;

export const styleReportLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_STYLE_REPORT,
  message: { error: "Too many style report requests. Try again later.", code: "rate_limit_exceeded" },
  standardHeaders: true,
  legacyHeaders: false,
});

export const lookPlanningLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_LOOK_PLANNING,
  message: { error: "Too many look planning requests. Try again later.", code: "rate_limit_exceeded" },
  standardHeaders: true,
  legacyHeaders: false,
});

export const looksAnalyzeLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_LOOKS_ANALYZE,
  message: { error: "Too many look analysis requests. Try again later.", code: "rate_limit_exceeded" },
  standardHeaders: true,
  legacyHeaders: false,
});
