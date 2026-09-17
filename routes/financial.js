/**
 * Financial Data Routes — 5 endpoints for Workflow C (Technical Analyst)
 * Data source: yahoo-finance2 (free, no API key)
 * Technical indicators: technicalindicators library
 */
const { Router } = require("express");
const { default: YahooFinance } = require("yahoo-finance2");
const { calculateIndicators } = require("../lib/indicators");

const router = Router();

// yahoo-finance2 v4 requires instantiation
const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// ─── 1. GET STOCK QUOTE ────────────────────────────────────────────────────
router.post("/get_stock_quote", async (req, res) => {
  try {
    const { ticker } = req.body;
    if (!ticker) return res.status(400).json({ error: "ticker is required" });

    const quote = await yahooFinance.quote(ticker.toUpperCase());

    res.json({
      ticker: quote.symbol,
      name: quote.shortName || quote.longName,
      price: quote.regularMarketPrice,
      change: quote.regularMarketChange,
      change_pct: quote.regularMarketChangePercent,
      volume: quote.regularMarketVolume,
      avg_volume: quote.averageDailyVolume10Day,
      volume_ratio:
        quote.averageDailyVolume10Day > 0
          ? Math.round(
              (quote.regularMarketVolume / quote.averageDailyVolume10Day) * 100
            ) / 100
          : null,
      day_high: quote.regularMarketDayHigh,
      day_low: quote.regularMarketDayLow,
      fifty_two_week_high: quote.fiftyTwoWeekHigh,
      fifty_two_week_low: quote.fiftyTwoWeekLow,
      market_cap: quote.marketCap,
      pe_ratio: quote.trailingPE,
      market_status: quote.marketState || "UNKNOWN",
      exchange: quote.exchange,
      currency: quote.currency,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[get_stock_quote]", err.message);
    res.status(500).json({ error: err.message, ticker: req.body.ticker });
  }
});

// ─── 2. GET HISTORICAL CANDLES ─────────────────────────────────────────────
router.post("/get_historical_candles", async (req, res) => {
  try {
    const { ticker, interval = "1d", start_date, limit = 100 } = req.body;
    if (!ticker) return res.status(400).json({ error: "ticker is required" });

    // Calculate period1 from start_date or default to ~6 months ago
    const period1 = start_date
      ? new Date(start_date)
      : new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

    // Map interval strings to yahoo-finance2 format
    const intervalMap = {
      "1min": "1m",
      "5min": "5m",
      "15min": "15m",
      "30min": "30m",
      "60min": "1h",
      daily: "1d",
      "1d": "1d",
      weekly: "1wk",
      "1wk": "1wk",
      monthly: "1mo",
      "1mo": "1mo",
    };
    const yInterval = intervalMap[interval] || "1d";

    const history = await yahooFinance.historical(ticker.toUpperCase(), {
      period1,
      interval: yInterval,
    });

    const candles = history.slice(-Math.min(limit, history.length)).map((c) => ({
      date: c.date.toISOString().split("T")[0],
      open: round(c.open),
      high: round(c.high),
      low: round(c.low),
      close: round(c.close),
      volume: c.volume,
    }));

    res.json({
      ticker: ticker.toUpperCase(),
      interval: yInterval,
      count: candles.length,
      candles,
    });
  } catch (err) {
    console.error("[get_historical_candles]", err.message);
    res.status(500).json({ error: err.message, ticker: req.body.ticker });
  }
});

// ─── 3. GET FUNDAMENTAL METRICS ────────────────────────────────────────────
router.post("/get_fundamental_metrics", async (req, res) => {
  try {
    const { ticker } = req.body;
    if (!ticker) return res.status(400).json({ error: "ticker is required" });

    const summary = await yahooFinance.quoteSummary(ticker.toUpperCase(), {
      modules: [
        "financialData",
        "defaultKeyStatistics",
        "incomeStatementHistory",
        "balanceSheetHistory",
        "earningsTrend",
        "price",
      ],
    });

    const fd = summary.financialData || {};
    const ks = summary.defaultKeyStatistics || {};
    const price = summary.price || {};

    // Revenue growth from income statements
    const incomeHistory =
      summary.incomeStatementHistory?.incomeStatementHistory || [];
    let revenueGrowthYoy = null;
    if (incomeHistory.length >= 2) {
      const recent = incomeHistory[0]?.totalRevenue;
      const prior = incomeHistory[1]?.totalRevenue;
      if (recent && prior && prior > 0) {
        revenueGrowthYoy = round(((recent - prior) / prior) * 100);
      }
    }

    // Balance sheet health
    const bs = summary.balanceSheetHistory?.balanceSheetStatements?.[0] || {};

    const debtToEquity = fd.debtToEquity || null;
    const currentRatio = fd.currentRatio || null;

    // Determine fundamental health
    let health = "MODERATE";
    const profitMargin = fd.profitMargins ? fd.profitMargins * 100 : null;
    if (profitMargin > 15 && currentRatio > 1.5 && debtToEquity < 100) {
      health = "STRONG";
    } else if (profitMargin < 0 || currentRatio < 0.8 || debtToEquity > 300) {
      health = "WEAK";
    }

    res.json({
      ticker: ticker.toUpperCase(),
      pe_ratio: price.trailingPE || ks.trailingPE || null,
      forward_pe: ks.forwardPE || null,
      peg_ratio: ks.pegRatio || null,
      price_to_book: ks.priceToBook || null,
      profit_margin: profitMargin != null ? round(profitMargin) : null,
      operating_margin: fd.operatingMargins
        ? round(fd.operatingMargins * 100)
        : null,
      return_on_equity: fd.returnOnEquity
        ? round(fd.returnOnEquity * 100)
        : null,
      revenue_growth_yoy: revenueGrowthYoy,
      earnings_growth: fd.earningsGrowth
        ? round(fd.earningsGrowth * 100)
        : null,
      debt_to_equity: debtToEquity ? round(debtToEquity) : null,
      current_ratio: currentRatio ? round(currentRatio) : null,
      total_cash: fd.totalCash || null,
      total_debt: fd.totalDebt || null,
      free_cash_flow: fd.freeCashflow || null,
      market_cap: price.marketCap || null,
      enterprise_value: ks.enterpriseValue || null,
      dividend_yield: ks.dividendYield
        ? round(ks.dividendYield * 100)
        : null,
      fundamental_health: health,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[get_fundamental_metrics]", err.message);
    res.status(500).json({ error: err.message, ticker: req.body.ticker });
  }
});

// ─── 4. GET TECHNICAL INDICATORS ───────────────────────────────────────────
router.post("/get_technical_indicators", async (req, res) => {
  try {
    const {
      ticker,
      indicators = ["ALL"],
      interval = "daily",
      period = 14,
    } = req.body;
    if (!ticker) return res.status(400).json({ error: "ticker is required" });

    // Fetch enough historical data for indicator calculations (200+ periods)
    const intervalMap = {
      daily: "1d",
      "1d": "1d",
      weekly: "1wk",
      "1wk": "1wk",
      "60min": "1h",
      "30min": "30m",
      "15min": "15m",
    };
    const yInterval = intervalMap[interval] || "1d";
    const lookback =
      yInterval === "1d"
        ? 365
        : yInterval === "1wk"
          ? 365 * 3
          : 30;
    const period1 = new Date(Date.now() - lookback * 24 * 60 * 60 * 1000);

    const history = await yahooFinance.historical(ticker.toUpperCase(), {
      period1,
      interval: yInterval,
    });

    const candles = history.map((c) => ({
      date: c.date.toISOString().split("T")[0],
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

    const indicatorNames = Array.isArray(indicators) ? indicators : [indicators];
    const results = calculateIndicators(candles, indicatorNames, period);

    res.json({
      ticker: ticker.toUpperCase(),
      interval: yInterval,
      data_points: candles.length,
      current_price: candles.length > 0 ? candles[candles.length - 1].close : null,
      indicators: results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[get_technical_indicators]", err.message);
    res.status(500).json({ error: err.message, ticker: req.body.ticker });
  }
});

// ─── 5. GET COMPANY PROFILE ────────────────────────────────────────────────
router.post("/get_company_profile", async (req, res) => {
  try {
    const { ticker } = req.body;
    if (!ticker) return res.status(400).json({ error: "ticker is required" });

    const summary = await yahooFinance.quoteSummary(ticker.toUpperCase(), {
      modules: ["assetProfile", "summaryProfile", "price", "summaryDetail"],
    });

    const profile = summary.assetProfile || {};
    const price = summary.price || {};
    const detail = summary.summaryDetail || {};

    res.json({
      ticker: ticker.toUpperCase(),
      name: price.shortName || price.longName,
      description: profile.longBusinessSummary || null,
      sector: profile.sector || null,
      industry: profile.industry || null,
      website: profile.website || null,
      market_cap: price.marketCap || null,
      employees: profile.fullTimeEmployees || null,
      country: profile.country || null,
      city: profile.city || null,
      exchange: price.exchangeName || null,
      currency: price.currency || null,
      fifty_two_week_high: detail.fiftyTwoWeekHigh || null,
      fifty_two_week_low: detail.fiftyTwoWeekLow || null,
      avg_volume: detail.averageVolume || null,
      beta: detail.beta || null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[get_company_profile]", err.message);
    res.status(500).json({ error: err.message, ticker: req.body.ticker });
  }
});

function round(val) {
  if (val == null || isNaN(val)) return null;
  return Math.round(val * 100) / 100;
}

module.exports = router;
