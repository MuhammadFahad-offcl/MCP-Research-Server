/**
 * MCP Research Server — Combined Financial Data + Web Research API
 * Serves 10 POST endpoints under /tools/* for n8n Workflow B & C agents.
 * Free data sources: yahoo-finance2, SEC EDGAR, keyword sentiment.
 */
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const authMiddleware = require("./middleware/auth");
const financialRoutes = require("./routes/financial");
const researchRoutes = require("./routes/research");

const app = express();
const PORT = process.env.PORT || 3001;

// ─── MIDDLEWARE ────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Health check (unauthenticated)
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    server: "MCP Research Server",
    version: "1.0.0",
    endpoints: 10,
    timestamp: new Date().toISOString(),
  });
});

// Apply auth to all /tools/* routes
app.use("/tools", authMiddleware);

// ─── ROUTES ───────────────────────────────────────────────────────────────
// Financial Data endpoints (Workflow C — Technical Analyst)
//   POST /tools/get_stock_quote
//   POST /tools/get_historical_candles
//   POST /tools/get_fundamental_metrics
//   POST /tools/get_technical_indicators
//   POST /tools/get_company_profile
app.use("/tools", financialRoutes);

// Web Research endpoints (Workflow B — Market Researcher)
//   POST /tools/search_financial_news
//   POST /tools/get_market_sentiment
//   POST /tools/search_sec_filings
//   POST /tools/get_earnings_calendar
//   POST /tools/web_search
app.use("/tools", researchRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    error: "Not found",
    available_endpoints: [
      "GET  /health",
      "POST /tools/get_stock_quote",
      "POST /tools/get_historical_candles",
      "POST /tools/get_fundamental_metrics",
      "POST /tools/get_technical_indicators",
      "POST /tools/get_company_profile",
      "POST /tools/search_financial_news",
      "POST /tools/get_market_sentiment",
      "POST /tools/search_sec_filings",
      "POST /tools/get_earnings_calendar",
      "POST /tools/web_search",
    ],
  });
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error("[UNHANDLED]", err);
  res.status(500).json({ error: "Internal server error" });
});

// ─── START ─────────────────────────────────────────────────────────────────
// Vercel uses the exported app; local dev uses app.listen()
if (process.env.VERCEL !== "1") {
  app.listen(PORT, () => {
    console.log(`\n  MCP Research Server running on port ${PORT}`);
    console.log(`  Health check: http://localhost:${PORT}/health`);
    console.log(`  Auth: ${process.env.API_KEY ? "ENABLED" : "DISABLED (dev mode)"}`);
    console.log(`  Endpoints: 10 tools under /tools/*\n`);
  });
}

module.exports = app;
