/**
 * Web Research Routes — 5 endpoints for Workflow B (Market Researcher)
 * Data sources: yahoo-finance2 (news/earnings), SEC EDGAR (filings), keyword sentiment
 * All free — no external API keys required.
 */
const { Router } = require("express");
const https = require("https");
const { analyzeSentiment } = require("../lib/sentiment");

const router = Router();

// Lazy-load yahoo-finance2 (avoids cold-start crash on Vercel)
let _yf = null;
function getYF() {
  if (!_yf) {
    const { default: YahooFinance } = require("yahoo-finance2");
    _yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
  }
  return _yf;
}

const SEC_USER_AGENT = `MCP-Research-Server/1.0 (${process.env.SEC_EDGAR_EMAIL || "research@example.com"})`;

// ─── 1. SEARCH FINANCIAL NEWS ──────────────────────────────────────────────
router.post("/search_financial_news", async (req, res) => {
  try {
    const { query, ticker, limit = 10 } = req.body;
    const searchTerm = ticker || query;
    if (!searchTerm) return res.status(400).json({ error: "query or ticker is required" });

    // Use Yahoo Finance search for news
    const searchResult = await getYF().search(searchTerm, {
      newsCount: Math.min(limit, 20),
      quotesCount: 0,
    });

    const articles = (searchResult.news || []).map((item) => ({
      headline: item.title,
      source: item.publisher || "Unknown",
      date: item.providerPublishTime
        ? new Date(item.providerPublishTime * 1000).toISOString()
        : null,
      url: item.link,
      summary: item.title, // Yahoo search doesn't provide full summaries
      thumbnail: item.thumbnail?.resolutions?.[0]?.url || null,
    }));

    // Also try quoteSummary for additional news context
    let companyNews = [];
    if (ticker) {
      try {
        const quote = await getYF().quote(ticker.toUpperCase());
        if (quote) {
          companyNews.push({
            headline: `${quote.shortName || ticker} trading at $${quote.regularMarketPrice} (${quote.regularMarketChangePercent > 0 ? "+" : ""}${round(quote.regularMarketChangePercent)}%)`,
            source: "Yahoo Finance Quote",
            date: new Date().toISOString(),
            impact: quote.regularMarketChangePercent > 2 ? "BULLISH" : quote.regularMarketChangePercent < -2 ? "BEARISH" : "NEUTRAL",
          });
        }
      } catch (_) {
        // Ignore quote errors — news search is primary
      }
    }

    res.json({
      query: searchTerm,
      total_articles_reviewed: articles.length,
      articles: articles.slice(0, limit),
      market_context: companyNews,
      key_themes: extractThemes(articles.map((a) => a.headline)),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[search_financial_news]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 2. GET MARKET SENTIMENT ───────────────────────────────────────────────
router.post("/get_market_sentiment", async (req, res) => {
  try {
    const { ticker, lookback_days = 7, source_count = 20 } = req.body;
    if (!ticker) return res.status(400).json({ error: "ticker is required" });

    // Gather headlines from Yahoo Finance
    const searchResult = await getYF().search(ticker.toUpperCase(), {
      newsCount: Math.min(source_count, 30),
      quotesCount: 0,
    });

    const headlines = (searchResult.news || []).map((item) => item.title);

    // Analyze sentiment
    const sentiment = analyzeSentiment(headlines, ticker);

    // Get current price context for divergence detection
    try {
      const quote = await getYF().quote(ticker.toUpperCase());
      const priceDirection = quote.regularMarketChangePercent > 0 ? "BULLISH" : "BEARISH";
      sentiment.sentiment_vs_price_divergence =
        (sentiment.overall === "BULLISH" && priceDirection === "BEARISH") ||
        (sentiment.overall === "BEARISH" && priceDirection === "BULLISH");
      sentiment.price_change_pct = round(quote.regularMarketChangePercent);
    } catch (_) {
      // Ignore — divergence stays false
    }

    res.json({
      ticker: ticker.toUpperCase(),
      lookback_days,
      ...sentiment,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[get_market_sentiment]", err.message);
    res.status(500).json({ error: err.message, ticker: req.body.ticker });
  }
});

// ─── 3. SEARCH SEC FILINGS ────────────────────────────────────────────────
router.post("/search_sec_filings", async (req, res) => {
  try {
    const { ticker, filing_type = "10-K", limit = 5 } = req.body;
    if (!ticker) return res.status(400).json({ error: "ticker is required" });

    // Call SEC EDGAR EFTS full-text search API
    const forms = Array.isArray(filing_type) ? filing_type.join(",") : filing_type;
    const url = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(ticker)}%22&dateRange=custom&startdt=${getDateMonthsAgo(24)}&enddt=${getToday()}&forms=${forms}&from=0&size=${limit}`;

    const edgarData = await fetchJSON(url, {
      "User-Agent": SEC_USER_AGENT,
      Accept: "application/json",
    });

    const filings = (edgarData.hits?.hits || []).map((hit) => {
      const src = hit._source || {};
      return {
        filing_type: src.form_type || filing_type,
        company: src.entity_name,
        filed_date: src.file_date,
        period_of_report: src.period_of_report,
        description: src.display_names?.[0] || src.file_description || "",
        accession_number: src.file_num,
        url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(ticker)}&type=${forms}&dateb=&owner=include&count=${limit}&search_text=&action=getcompany`,
      };
    });

    // If EFTS returns no results, try the company submissions endpoint
    if (filings.length === 0) {
      const altFilings = await searchEdgarSubmissions(ticker, filing_type, limit);
      if (altFilings.length > 0) {
        return res.json({
          ticker: ticker.toUpperCase(),
          filing_type: forms,
          total_found: altFilings.length,
          filings: altFilings,
          source: "SEC EDGAR Submissions",
          timestamp: new Date().toISOString(),
        });
      }
    }

    res.json({
      ticker: ticker.toUpperCase(),
      filing_type: forms,
      total_found: edgarData.hits?.total?.value || filings.length,
      filings,
      source: "SEC EDGAR EFTS",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[search_sec_filings]", err.message);
    res.status(500).json({ error: err.message, ticker: req.body.ticker });
  }
});

// ─── 4. GET EARNINGS CALENDAR ──────────────────────────────────────────────
router.post("/get_earnings_calendar", async (req, res) => {
  try {
    const { ticker } = req.body;
    if (!ticker) return res.status(400).json({ error: "ticker is required" });

    const summary = await getYF().quoteSummary(ticker.toUpperCase(), {
      modules: ["calendarEvents", "earningsTrend", "earnings"],
    });

    const calendar = summary.calendarEvents || {};
    const trend = summary.earningsTrend?.trend || [];
    const earnings = summary.earnings || {};

    // Extract next earnings date
    const earningsDate = calendar.earnings?.earningsDate?.[0] || null;
    const daysUntilEarnings = earningsDate
      ? Math.ceil((new Date(earningsDate) - new Date()) / (1000 * 60 * 60 * 24))
      : null;

    // Current quarter estimate
    const currentQuarter = trend.find((t) => t.period === "0q") || {};

    // Historical earnings surprises
    const history = earnings.earningsChart?.quarterly || [];
    const surpriseDirection =
      history.length > 0
        ? history.filter((q) => (q.actual || 0) > (q.estimate || 0)).length >
          history.length / 2
          ? "BEAT"
          : "MISS"
        : "UNKNOWN";

    res.json({
      ticker: ticker.toUpperCase(),
      next_earnings_date: earningsDate
        ? new Date(earningsDate).toISOString().split("T")[0]
        : null,
      days_until_earnings: daysUntilEarnings,
      earnings_volatility_flag:
        daysUntilEarnings !== null && daysUntilEarnings <= 10,
      consensus_eps: currentQuarter.earningsEstimate?.avg || null,
      eps_high: currentQuarter.earningsEstimate?.high || null,
      eps_low: currentQuarter.earningsEstimate?.low || null,
      revenue_estimate: currentQuarter.revenueEstimate?.avg || null,
      number_of_analysts: currentQuarter.earningsEstimate?.numberOfAnalysts || null,
      historical_surprise_direction: surpriseDirection,
      recent_quarters: history.map((q) => ({
        quarter: q.date,
        actual_eps: q.actual,
        estimated_eps: q.estimate,
        surprise: q.actual && q.estimate ? round(q.actual - q.estimate) : null,
      })),
      ex_dividend_date: calendar.exDividendDate
        ? new Date(calendar.exDividendDate).toISOString().split("T")[0]
        : null,
      dividend_date: calendar.dividendDate
        ? new Date(calendar.dividendDate).toISOString().split("T")[0]
        : null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[get_earnings_calendar]", err.message);
    res.status(500).json({ error: err.message, ticker: req.body.ticker });
  }
});

// ─── 5. WEB SEARCH ────────────────────────────────────────────────────────
router.post("/web_search", async (req, res) => {
  try {
    const { query, max_results = 5 } = req.body;
    if (!query) return res.status(400).json({ error: "query is required" });

    // Use Yahoo Finance search as a financial web search proxy
    const searchResult = await getYF().search(query, {
      newsCount: max_results,
      quotesCount: 5,
    });

    const newsResults = (searchResult.news || []).map((item) => ({
      title: item.title,
      url: item.link,
      snippet: item.title,
      source: item.publisher || "Unknown",
      date: item.providerPublishTime
        ? new Date(item.providerPublishTime * 1000).toISOString()
        : null,
      type: "news",
    }));

    const quoteResults = (searchResult.quotes || []).map((q) => ({
      title: `${q.shortname || q.longname || q.symbol} (${q.symbol})`,
      url: `https://finance.yahoo.com/quote/${q.symbol}`,
      snippet: `${q.typeDisp || "Equity"} — ${q.exchDisp || q.exchange}`,
      source: "Yahoo Finance",
      type: "quote",
    }));

    res.json({
      query,
      total_results: newsResults.length + quoteResults.length,
      results: [...newsResults, ...quoteResults].slice(0, max_results),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[web_search]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── HELPERS ───────────────────────────────────────────────────────────────

/** Fetch JSON from a URL using native https */
function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: { ...headers, Accept: "application/json" },
    };
    const req = https.request(options, (resp) => {
      let data = "";
      resp.on("data", (chunk) => (data += chunk));
      resp.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ raw: data });
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("SEC EDGAR request timed out"));
    });
    req.end();
  });
}

/** Search EDGAR company submissions as a fallback */
async function searchEdgarSubmissions(ticker, filingType, limit) {
  try {
    // First, resolve ticker to CIK via company tickers JSON
    const tickersUrl = "https://www.sec.gov/files/company_tickers.json";
    const tickers = await fetchJSON(tickersUrl, { "User-Agent": SEC_USER_AGENT });

    let cik = null;
    for (const entry of Object.values(tickers)) {
      if (entry.ticker && entry.ticker.toUpperCase() === ticker.toUpperCase()) {
        cik = String(entry.cik_str).padStart(10, "0");
        break;
      }
    }
    if (!cik) return [];

    const subUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
    const sub = await fetchJSON(subUrl, { "User-Agent": SEC_USER_AGENT });

    const recent = sub.filings?.recent || {};
    const forms = recent.form || [];
    const dates = recent.filingDate || [];
    const accessions = recent.accessionNumber || [];
    const primaryDocs = recent.primaryDocument || [];
    const descriptions = recent.primaryDocDescription || [];

    const results = [];
    const types = Array.isArray(filingType)
      ? filingType.map((t) => t.toUpperCase())
      : [filingType.toUpperCase()];

    for (let i = 0; i < forms.length && results.length < limit; i++) {
      if (types.includes(forms[i].toUpperCase()) || types.includes("ALL")) {
        const accNum = accessions[i].replace(/-/g, "");
        results.push({
          filing_type: forms[i],
          company: sub.name,
          filed_date: dates[i],
          description: descriptions[i] || forms[i],
          url: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accNum}/${primaryDocs[i]}`,
        });
      }
    }
    return results;
  } catch (err) {
    console.error("[searchEdgarSubmissions]", err.message);
    return [];
  }
}

function extractThemes(headlines) {
  const words = {};
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "in", "on", "at", "to",
    "for", "of", "and", "or", "but", "not", "this", "that", "with", "by",
    "from", "as", "it", "its", "be", "has", "have", "had", "do", "does",
    "will", "would", "could", "should", "may", "might", "can", "shall",
    "says", "said", "new", "s", "t", "vs", "after", "before",
  ]);
  for (const h of headlines) {
    for (const w of h.toLowerCase().split(/\W+/)) {
      if (w.length > 2 && !stopWords.has(w)) {
        words[w] = (words[w] || 0) + 1;
      }
    }
  }
  return Object.entries(words)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w);
}

function getDateMonthsAgo(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().split("T")[0];
}

function getToday() {
  return new Date().toISOString().split("T")[0];
}

function round(val) {
  if (val == null || isNaN(val)) return null;
  return Math.round(val * 100) / 100;
}

module.exports = router;
