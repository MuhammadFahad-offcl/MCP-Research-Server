/**
 * Technical indicator calculations using the technicalindicators library.
 * Takes raw OHLCV data and returns computed indicator values.
 */
const ti = require("technicalindicators");

/**
 * Calculate a suite of technical indicators from OHLCV candle data.
 * @param {Array} candles - Array of { date, open, high, low, close, volume }
 * @param {string[]} indicators - List of indicator names to compute
 * @param {number} period - Lookback period (default 14)
 * @returns {Object} indicator results keyed by name
 */
function calculateIndicators(candles, indicators = [], period = 14) {
  if (!candles || candles.length < 2) {
    return { error: "Insufficient candle data for indicator calculation" };
  }

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);
  const results = {};

  const requested = new Set(indicators.map((i) => i.toUpperCase()));
  const all = requested.size === 0 || requested.has("ALL");

  // RSI
  if (all || requested.has("RSI")) {
    try {
      const rsiValues = ti.RSI.calculate({ values: closes, period });
      const latest = rsiValues[rsiValues.length - 1];
      results.rsi = {
        period,
        value: round(latest),
        signal:
          latest > 70 ? "OVERBOUGHT" : latest < 30 ? "OVERSOLD" : "NEUTRAL",
        history: rsiValues.slice(-10).map(round),
      };
    } catch (e) {
      results.rsi = { error: e.message };
    }
  }

  // SMA (multiple periods)
  if (all || requested.has("SMA")) {
    try {
      const periods = [20, 50, 200];
      results.sma = {};
      for (const p of periods) {
        if (closes.length >= p) {
          const vals = ti.SMA.calculate({ values: closes, period: p });
          results.sma[`sma_${p}`] = round(vals[vals.length - 1]);
        }
      }
      const price = closes[closes.length - 1];
      results.sma.price_vs_sma20 =
        price > (results.sma.sma_20 || 0) ? "ABOVE" : "BELOW";
      results.sma.price_vs_sma50 =
        price > (results.sma.sma_50 || 0) ? "ABOVE" : "BELOW";
      results.sma.price_vs_sma200 =
        price > (results.sma.sma_200 || 0) ? "ABOVE" : "BELOW";
    } catch (e) {
      results.sma = { error: e.message };
    }
  }

  // EMA
  if (all || requested.has("EMA")) {
    try {
      results.ema = {};
      for (const p of [9, 21]) {
        const vals = ti.EMA.calculate({ values: closes, period: p });
        results.ema[`ema_${p}`] = round(vals[vals.length - 1]);
      }
    } catch (e) {
      results.ema = { error: e.message };
    }
  }

  // MACD
  if (all || requested.has("MACD")) {
    try {
      const macdValues = ti.MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
      });
      const latest = macdValues[macdValues.length - 1];
      if (latest) {
        results.macd = {
          macd_line: round(latest.MACD),
          signal_line: round(latest.signal),
          histogram: round(latest.histogram),
          signal: latest.histogram > 0 ? "BULLISH" : "BEARISH",
        };
      }
    } catch (e) {
      results.macd = { error: e.message };
    }
  }

  // Bollinger Bands
  if (all || requested.has("BBANDS") || requested.has("BOLLINGER")) {
    try {
      const bbValues = ti.BollingerBands.calculate({
        values: closes,
        period: 20,
        stdDev: 2,
      });
      const latest = bbValues[bbValues.length - 1];
      if (latest) {
        const price = closes[closes.length - 1];
        const range = latest.upper - latest.lower;
        const position =
          price > latest.middle + range * 0.25
            ? "UPPER_HALF"
            : price < latest.middle - range * 0.25
              ? "LOWER_HALF"
              : "MIDDLE";
        results.bollinger = {
          upper: round(latest.upper),
          middle: round(latest.middle),
          lower: round(latest.lower),
          bandwidth: round(range / latest.middle),
          position,
        };
      }
    } catch (e) {
      results.bollinger = { error: e.message };
    }
  }

  // ATR
  if (all || requested.has("ATR")) {
    try {
      const atrValues = ti.ATR.calculate({
        high: highs,
        low: lows,
        close: closes,
        period,
      });
      results.atr = {
        period,
        value: round(atrValues[atrValues.length - 1]),
        history: atrValues.slice(-5).map(round),
      };
    } catch (e) {
      results.atr = { error: e.message };
    }
  }

  // ADX
  if (all || requested.has("ADX")) {
    try {
      const adxValues = ti.ADX.calculate({
        high: highs,
        low: lows,
        close: closes,
        period,
      });
      const latest = adxValues[adxValues.length - 1];
      if (latest) {
        results.adx = {
          value: round(latest.adx),
          pdi: round(latest.pdi),
          mdi: round(latest.mdi),
          trend_strength:
            latest.adx > 25
              ? "STRONG"
              : latest.adx > 20
                ? "MODERATE"
                : "WEAK",
        };
      }
    } catch (e) {
      results.adx = { error: e.message };
    }
  }

  // OBV
  if (all || requested.has("OBV")) {
    try {
      const obvValues = ti.OBV.calculate({ close: closes, volume: volumes });
      results.obv = {
        value: obvValues[obvValues.length - 1],
        trend:
          obvValues[obvValues.length - 1] > obvValues[obvValues.length - 6]
            ? "RISING"
            : "FALLING",
      };
    } catch (e) {
      results.obv = { error: e.message };
    }
  }

  // Stochastic
  if (all || requested.has("STOCH")) {
    try {
      const stochValues = ti.Stochastic.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: 14,
        signalPeriod: 3,
      });
      const latest = stochValues[stochValues.length - 1];
      if (latest) {
        results.stochastic = {
          k: round(latest.k),
          d: round(latest.d),
          signal:
            latest.k > 80
              ? "OVERBOUGHT"
              : latest.k < 20
                ? "OVERSOLD"
                : "NEUTRAL",
        };
      }
    } catch (e) {
      results.stochastic = { error: e.message };
    }
  }

  return results;
}

function round(val) {
  if (val == null || isNaN(val)) return null;
  return Math.round(val * 100) / 100;
}

module.exports = { calculateIndicators };
