/**
 * Simple keyword-based sentiment analysis for financial news headlines.
 * No external API required — works offline with a curated word list.
 */

const BULLISH_WORDS = new Set([
  "surge", "surges", "surging", "soar", "soars", "soaring",
  "rally", "rallies", "rallying", "gain", "gains", "gaining",
  "jump", "jumps", "jumping", "rise", "rises", "rising",
  "climb", "climbs", "climbing", "upgrade", "upgrades", "upgraded",
  "beat", "beats", "beating", "exceed", "exceeds", "exceeded",
  "outperform", "outperforms", "strong", "stronger", "strongest",
  "bullish", "optimistic", "optimism", "positive", "growth",
  "record", "high", "highs", "breakout", "momentum", "buy",
  "upside", "opportunity", "profit", "profitable", "recovery",
  "boom", "booming", "innovation", "expand", "expansion",
  "dividend", "buyback", "repurchase", "approved", "launch",
]);

const BEARISH_WORDS = new Set([
  "crash", "crashes", "crashing", "plunge", "plunges", "plunging",
  "drop", "drops", "dropping", "fall", "falls", "falling",
  "decline", "declines", "declining", "sink", "sinks", "sinking",
  "slide", "slides", "sliding", "downgrade", "downgrades", "downgraded",
  "miss", "misses", "missed", "disappoint", "disappoints", "disappointed",
  "underperform", "underperforms", "weak", "weaker", "weakest",
  "bearish", "pessimistic", "pessimism", "negative", "recession",
  "low", "lows", "breakdown", "sell", "selloff", "sell-off",
  "downside", "risk", "risky", "loss", "losses", "losing",
  "bust", "busting", "layoff", "layoffs", "cut", "cuts",
  "warning", "warns", "debt", "default", "bankruptcy", "fraud",
  "investigation", "lawsuit", "penalty", "fine", "recall",
]);

/**
 * Analyze sentiment of an array of headlines/text snippets.
 * @param {string[]} texts - Array of headlines or text snippets
 * @param {string} ticker - Optional ticker for context
 * @returns {Object} Sentiment analysis result
 */
function analyzeSentiment(texts, ticker = "") {
  if (!texts || texts.length === 0) {
    return {
      overall: "NEUTRAL",
      confidence: 0,
      bullish_drivers: [],
      bearish_drivers: [],
      sample_size: 0,
    };
  }

  let bullishScore = 0;
  let bearishScore = 0;
  const bullishDrivers = new Map();
  const bearishDrivers = new Map();

  for (const text of texts) {
    const words = text.toLowerCase().split(/\W+/);
    for (const word of words) {
      if (BULLISH_WORDS.has(word)) {
        bullishScore++;
        bullishDrivers.set(word, (bullishDrivers.get(word) || 0) + 1);
      }
      if (BEARISH_WORDS.has(word)) {
        bearishScore++;
        bearishDrivers.set(word, (bearishDrivers.get(word) || 0) + 1);
      }
    }
  }

  const total = bullishScore + bearishScore;
  const netScore = total > 0 ? (bullishScore - bearishScore) / total : 0;
  const confidence = total > 0 ? Math.min(total / (texts.length * 2), 1) : 0;

  const overall =
    netScore > 0.15 ? "BULLISH" : netScore < -0.15 ? "BEARISH" : "NEUTRAL";

  const topBullish = [...bullishDrivers.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);

  const topBearish = [...bearishDrivers.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);

  return {
    overall,
    confidence: Math.round(confidence * 100) / 100,
    net_score: Math.round(netScore * 100) / 100,
    bullish_count: bullishScore,
    bearish_count: bearishScore,
    bullish_drivers: topBullish,
    bearish_drivers: topBearish,
    sample_size: texts.length,
    sentiment_vs_price_divergence: false,
  };
}

module.exports = { analyzeSentiment };
