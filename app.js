const COINS = [
  { rank: 1, symbol: "BTC", name: "Bitcoin" },
  { rank: 2, symbol: "ETH", name: "Ethereum" },
  { rank: 3, symbol: "BNB", name: "BNB" },
  { rank: 4, symbol: "SOL", name: "Solana" },
  { rank: 5, symbol: "XRP", name: "XRP" },
  { rank: 6, symbol: "DOGE", name: "Dogecoin" },
  { rank: 7, symbol: "ADA", name: "Cardano" },
  { rank: 8, symbol: "TRX", name: "TRON" },
  { rank: 9, symbol: "AVAX", name: "Avalanche" },
  { rank: 10, symbol: "LINK", name: "Chainlink" },
  { rank: 11, symbol: "DOT", name: "Polkadot" },
  { rank: 12, symbol: "BCH", name: "Bitcoin Cash" },
  { rank: 13, symbol: "LTC", name: "Litecoin" },
  { rank: 14, symbol: "UNI", name: "Uniswap" },
  { rank: 15, symbol: "NEAR", name: "NEAR Protocol" },
  { rank: 16, symbol: "APT", name: "Aptos" },
  { rank: 17, symbol: "ICP", name: "Internet Computer" },
  { rank: 18, symbol: "ETC", name: "Ethereum Classic" },
  { rank: 19, symbol: "FIL", name: "Filecoin" },
  { rank: 20, symbol: "ARB", name: "Arbitrum" }
];

let priceChart = null;
let lastResult = null;
const el = (id) => document.getElementById(id);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const fmtUSD = (n) => {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Math.abs(n) >= 1) return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return "$" + n.toLocaleString(undefined, { maximumSignificantDigits: 6 });
};
const fmtPct = (n) => Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(2)}%` : "—";

const INTERVALS = {
  "1h": { binance: "1h", bybit: "60", okx: "1H", label: "1H" },
  "4h": { binance: "4h", bybit: "240", okx: "4H", label: "4H" },
  "1d": { binance: "1d", bybit: "D", okx: "1D", label: "1D" }
};

function withTimeout(ms = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, clear: () => clearTimeout(timer) };
}

async function fetchJson(url, ms = 10000) {
  const { controller, clear } = withTimeout(ms);
  try {
    const res = await fetch(url, { cache: "no-store", mode: "cors", signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clear();
  }
}

function normalizeSymbol(symbol, exchange, market) {
  if (exchange === "okx") return market === "futures" ? `${symbol}-USDT-SWAP` : `${symbol}-USDT`;
  return `${symbol}USDT`;
}

function getProviderConfigs(symbol, market, interval, limit = 220) {
  const i = INTERVALS[interval] || INTERVALS["4h"];
  const binanceSymbol = normalizeSymbol(symbol, "binance", market);
  const bybitSymbol = normalizeSymbol(symbol, "bybit", market);
  const okxInst = normalizeSymbol(symbol, "okx", market);
  return [
    {
      id: "binance",
      name: market === "futures" ? "Binance Futures" : "Binance Spot",
      klineUrl: market === "futures"
        ? `https://fapi.binance.com/fapi/v1/klines?symbol=${binanceSymbol}&interval=${i.binance}&limit=${limit}`
        : `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${i.binance}&limit=${limit}`,
      tickerUrl: market === "futures"
        ? `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${binanceSymbol}`
        : `https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSymbol}`,
      parseKlines: (rows) => rows.map(r => ({
        time: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5])
      })),
      parseTicker: (t) => ({ price: Number(t.lastPrice), change24: Number(t.priceChangePercent), volume24: Number(t.quoteVolume) })
    },
    {
      id: "bybit",
      name: market === "futures" ? "Bybit Linear" : "Bybit Spot",
      klineUrl: `https://api.bybit.com/v5/market/kline?category=${market === "futures" ? "linear" : "spot"}&symbol=${bybitSymbol}&interval=${i.bybit}&limit=${limit}`,
      tickerUrl: `https://api.bybit.com/v5/market/tickers?category=${market === "futures" ? "linear" : "spot"}&symbol=${bybitSymbol}`,
      parseKlines: (json) => {
        const rows = json?.result?.list || [];
        if (String(json?.retCode) !== "0" || !rows.length) throw new Error(json?.retMsg || "Bybit 沒有資料");
        return rows.map(r => ({
          time: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5])
        })).sort((a, b) => a.time - b.time);
      },
      parseTicker: (json) => {
        const t = json?.result?.list?.[0];
        if (!t) return {};
        return { price: Number(t.lastPrice), change24: Number(t.price24hPcnt) * 100, volume24: Number(t.turnover24h) };
      }
    },
    {
      id: "okx",
      name: market === "futures" ? "OKX Swap" : "OKX Spot",
      klineUrl: `https://www.okx.com/api/v5/market/candles?instId=${okxInst}&bar=${i.okx}&limit=${limit}`,
      tickerUrl: `https://www.okx.com/api/v5/market/ticker?instId=${okxInst}`,
      parseKlines: (json) => {
        const rows = json?.data || [];
        if (String(json?.code) !== "0" || !rows.length) throw new Error(json?.msg || "OKX 沒有資料");
        return rows.map(r => ({
          time: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[7] || r[5])
        })).sort((a, b) => a.time - b.time);
      },
      parseTicker: (json) => {
        const t = json?.data?.[0];
        if (!t) return {};
        const price = Number(t.last);
        const open24h = Number(t.open24h);
        return { price, change24: open24h ? ((price - open24h) / open24h) * 100 : NaN, volume24: Number(t.volCcy24h) };
      }
    }
  ];
}

async function loadMarketData(symbol, market, interval) {
  const errors = [];
  for (const p of getProviderConfigs(symbol, market, interval)) {
    try {
      const [klineRaw, tickerRaw] = await Promise.all([
        fetchJson(p.klineUrl, 12000),
        fetchJson(p.tickerUrl, 12000).catch(() => null)
      ]);
      const candles = p.parseKlines(klineRaw).filter(c => [c.open, c.high, c.low, c.close].every(Number.isFinite));
      if (candles.length < 60) throw new Error("K 線數量不足，無法計算 SMA50 / RSI / ATR");
      const ticker = tickerRaw ? p.parseTicker(tickerRaw) : {};
      return { provider: p.name, providerId: p.id, candles, ticker };
    } catch (err) {
      errors.push(`${p.name}: ${err.message || err}`);
    }
  }
  throw new Error(errors.join("｜"));
}

function sma(values, period) {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    const slice = values.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

function ema(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[i] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function rsi(values, period = 14) {
  if (values.length <= period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function atr(candles, period = 14) {
  if (candles.length <= period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function standardDeviation(arr) {
  if (!arr.length) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, n) => s + Math.pow(n - mean, 2), 0) / arr.length);
}

function pctChange(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return 0;
  return ((to - from) / from) * 100;
}

function getLevels(candles, lookback = 40) {
  const slice = candles.slice(-lookback);
  const lows = slice.map(c => c.low);
  const highs = slice.map(c => c.high);
  return {
    support: Math.min(...lows),
    resistance: Math.max(...highs),
    recentLow: Math.min(...candles.slice(-10).map(c => c.low)),
    recentHigh: Math.max(...candles.slice(-10).map(c => c.high))
  };
}

function calculateTrendStrength(closes) {
  const n = Math.min(30, closes.length);
  const slice = closes.slice(-n);
  const first = slice[0], last = slice.at(-1);
  return pctChange(first, last);
}

function analyzeTechnical(coin, marketData, market, interval) {
  const candles = marketData.candles;
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume).filter(Number.isFinite);
  const close = closes.at(-1);
  const sma20Arr = sma(closes, 20);
  const sma50Arr = sma(closes, 50);
  const ema20Arr = ema(closes, 20);
  const sma20 = sma20Arr.at(-1);
  const sma50 = sma50Arr.at(-1);
  const ema20 = ema20Arr.at(-1);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(candles, 14);
  const levels = getLevels(candles, 40);
  const returns = closes.slice(1).map((p, i) => (p - closes[i]) / closes[i]).filter(Number.isFinite);
  const volFactor = interval === "1d" ? Math.sqrt(365) : interval === "4h" ? Math.sqrt(365 * 6) : Math.sqrt(365 * 24);
  const volatility = standardDeviation(returns.slice(-60)) * volFactor * 100;
  const avgVol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(20, volumes.length));
  const lastVol = volumes.at(-1);
  const volumeRatio = avgVol20 ? lastVol / avgVol20 : 1;
  const bars7 = interval === "1d" ? 7 : interval === "4h" ? 42 : 168;
  const bars14 = bars7 * 2;
  const change7 = pctChange(closes.at(-Math.min(bars7 + 1, closes.length)), close);
  const change14 = pctChange(closes.at(-Math.min(bars14 + 1, closes.length)), close);
  const trend30 = calculateTrendStrength(closes);

  let longScore = 0;
  let shortScore = 0;
  const reasons = [];

  if (close > sma20) { longScore += 15; reasons.push("價格站上 SMA20，短線結構偏多。"); }
  else { shortScore += 15; reasons.push("價格跌破 SMA20，短線結構偏弱。"); }

  if (close > sma50) { longScore += 15; reasons.push("價格站上 SMA50，中期趨勢較健康。"); }
  else { shortScore += 15; reasons.push("價格跌破 SMA50，中期趨勢偏弱。"); }

  if (sma20 > sma50) { longScore += 14; reasons.push("SMA20 高於 SMA50，均線排列偏多。"); }
  else { shortScore += 14; reasons.push("SMA20 低於 SMA50，均線排列偏空。"); }

  if (ema20 > sma50 && close > ema20) { longScore += 8; reasons.push("價格守在 EMA20 上方，回踩承接力較佳。"); }
  if (ema20 < sma50 && close < ema20) { shortScore += 8; reasons.push("價格受 EMA20 壓制，反彈力道偏弱。"); }

  if (rsi14 >= 52 && rsi14 <= 68) { longScore += 13; reasons.push("RSI 處於偏強但未極端過熱區間。"); }
  else if (rsi14 > 74) { shortScore += 10; reasons.push("RSI 過熱，追多容易遇到回調。"); }
  else if (rsi14 < 45) { shortScore += 13; reasons.push("RSI 低於 45，動能偏弱。"); }
  else { longScore += 4; shortScore += 4; reasons.push("RSI 位於中性區，需要價格突破確認方向。"); }

  if (change7 > 2 && change14 > 0) { longScore += 12; reasons.push("近 7 日與 14 日趨勢同步向上。"); }
  else if (change7 < -2 && change14 < 0) { shortScore += 12; reasons.push("近 7 日與 14 日趨勢同步向下。"); }
  else { longScore += 4; shortScore += 4; reasons.push("近期方向不夠一致，可能仍在震盪。"); }

  if (volumeRatio > 1.15 && change7 > 0) { longScore += 8; reasons.push("近期上漲伴隨量能放大，多方訊號可信度提高。"); }
  else if (volumeRatio > 1.15 && change7 < 0) { shortScore += 8; reasons.push("近期下跌伴隨量能放大，空方訊號可信度提高。"); }
  else { reasons.push("量能沒有明顯放大，突破或跌破訊號需要保守看待。"); }

  const upside = ((levels.resistance - close) / close) * 100;
  const downside = ((close - levels.support) / close) * 100;
  if (upside > downside * 1.15) { longScore += 7; reasons.push("上方空間大於下方風險，Long 的風險報酬較佳。"); }
  if (downside > upside * 1.15) { shortScore += 7; reasons.push("下方空間大於上方風險，Short 的風險報酬較佳。"); }

  longScore = clamp(Math.round(longScore), 0, 100);
  shortScore = clamp(Math.round(shortScore), 0, 100);

  let side = "WAIT";
  if (longScore >= 66 && longScore - shortScore >= 10) side = "LONG";
  if (shortScore >= 66 && shortScore - longScore >= 10) side = "SHORT";

  const atrPct = atr14 ? atr14 / close : 0.035;
  const pullbackPct = clamp(atrPct * 0.45, 0.0025, 0.035);
  const stopPct = clamp(atrPct * 1.45, 0.012, 0.11);
  let entry, stop, tp1, tp2, tp3;

  if (side === "LONG") {
    entry = Math.min(close, Math.max(levels.support * 1.004, close * (1 - pullbackPct)));
    stop = Math.min(levels.support * 0.992, entry * (1 - stopPct));
    const risk = entry - stop;
    tp1 = entry + risk;
    tp2 = entry + risk * 2;
    tp3 = entry + risk * 3;
  } else if (side === "SHORT") {
    entry = Math.max(close, Math.min(levels.resistance * 0.996, close * (1 + pullbackPct)));
    stop = Math.max(levels.resistance * 1.008, entry * (1 + stopPct));
    const risk = stop - entry;
    tp1 = entry - risk;
    tp2 = entry - risk * 2;
    tp3 = entry - risk * 3;
  } else if (longScore >= shortScore) {
    entry = Math.max(levels.support * 1.005, close * (1 - pullbackPct));
    stop = Math.min(levels.support * 0.99, entry * (1 - stopPct));
    const risk = entry - stop;
    tp1 = entry + risk;
    tp2 = entry + risk * 2;
    tp3 = entry + risk * 3;
  } else {
    entry = Math.min(levels.resistance * 0.995, close * (1 + pullbackPct));
    stop = Math.max(levels.resistance * 1.01, entry * (1 + stopPct));
    const risk = stop - entry;
    tp1 = entry - risk;
    tp2 = entry - risk * 2;
    tp3 = entry - risk * 3;
  }

  const riskPerUnit = Math.abs(entry - stop);
  const rr = riskPerUnit ? Math.abs(tp2 - entry) / riskPerUnit : 0;
  return {
    coin, market, interval, provider: marketData.provider, candles, closes, sma20Arr, sma50Arr,
    close, sma20, sma50, ema20, rsi14, atr14, volatility, volumeRatio, levels, change7,
    change14, trend30, longScore, shortScore, side, entry, stop, tp1, tp2, tp3, rr,
    riskPerUnit, change24: marketData.ticker.change24, volume24: marketData.ticker.volume24, reasons
  };
}

function humanFetchError(err) {
  const msg = String(err?.message || err);
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("aborted")) {
    return "瀏覽器無法連到交易所 API。請改用 Chrome/Edge、關閉 VPN/擋廣告，或使用本機伺服器 python -m http.server 8000 開啟";
  }
  if (msg.includes("451")) return "交易所 API 可能因所在地區或網路被限制，請切換資料源、網路或手機熱點測試";
  if (msg.includes("429")) return "請求過於頻繁，請等待 1–3 分鐘後重試";
  return msg;
}

function makeDecisionText(r) {
  if (r.side === "LONG") {
    return `AI 評分偏多，但不要用市價盲目追高。較佳做法是等價格接近 ${fmtUSD(r.entry)}，止損放 ${fmtUSD(r.stop)}，TP1 ${fmtUSD(r.tp1)}，主目標 TP2 ${fmtUSD(r.tp2)}。`;
  }
  if (r.side === "SHORT") {
    return `AI 評分偏空，適合等待反彈到壓力附近再觀察空方訊號。參考進場 ${fmtUSD(r.entry)}，止損 ${fmtUSD(r.stop)}，TP1 ${fmtUSD(r.tp1)}，主目標 TP2 ${fmtUSD(r.tp2)}。`;
  }
  return `目前 Long / Short 分數沒有明顯優勢，或風險報酬不足。建議等待突破 ${fmtUSD(r.levels.resistance)} 後回踩，或跌破 ${fmtUSD(r.levels.support)} 後反彈回測，再重新判斷。`;
}

function renderResult(r) {
  lastResult = r;
  const sideClass = r.side === "LONG" ? "long" : r.side === "SHORT" ? "short" : "wait";
  const badgeText = r.side === "LONG" ? "可以觀察做多" : r.side === "SHORT" ? "可以觀察做空" : "不建議追單，等待";
  el("decisionBadge").className = `badge ${sideClass}`;
  el("decisionBadge").textContent = badgeText;
  el("coinTitle").textContent = `${r.coin.name} (${r.coin.symbol}/USDT)｜現價 ${fmtUSD(r.close)}`;
  el("decisionText").textContent = makeDecisionText(r);
  el("longScore").textContent = r.longScore;
  el("shortScore").textContent = r.shortScore;
  el("longBar").style.width = `${r.longScore}%`;
  el("shortBar").style.width = `${r.shortScore}%`;
  el("lastUpdated").textContent = `更新：${new Date().toLocaleString("zh-TW")}`;
  el("chartSource").textContent = `${r.provider}｜${r.market === "futures" ? "合約" : "現貨"}｜${INTERVALS[r.interval].label} K 線`;

  el("sideOut").textContent = r.side === "WAIT" ? "等待確認" : r.side;
  el("entryOut").textContent = fmtUSD(r.entry);
  el("stopOut").textContent = fmtUSD(r.stop);
  el("tp1Out").textContent = fmtUSD(r.tp1);
  el("tp2Out").textContent = fmtUSD(r.tp2);
  el("tp3Out").textContent = fmtUSD(r.tp3);
  el("rrOut").textContent = `約 1:${r.rr.toFixed(2)}`;

  const account = Number(el("accountInput").value || 1000);
  const riskPct = Number(el("riskSelect").value || 0.01);
  const maxLoss = account * riskPct;
  const units = r.riskPerUnit ? maxLoss / r.riskPerUnit : 0;
  const notional = units * r.entry;
  el("positionOut").textContent = `${fmtUSD(notional)}｜最大虧損 ${fmtUSD(maxLoss)}`;

  el("metrics").innerHTML = [
    ["資料源", r.provider], ["K 線週期", INTERVALS[r.interval].label], ["SMA20", fmtUSD(r.sma20)], ["SMA50", fmtUSD(r.sma50)],
    ["EMA20", fmtUSD(r.ema20)], ["RSI 14", r.rsi14?.toFixed(2) ?? "—"], ["ATR 14", fmtUSD(r.atr14)],
    ["波動率", `${r.volatility.toFixed(2)}%`], ["近 7 日", fmtPct(r.change7)], ["近 14 日", fmtPct(r.change14)],
    ["24h", fmtPct(r.change24)], ["支撐", fmtUSD(r.levels.support)], ["壓力", fmtUSD(r.levels.resistance)], ["量能比", `${r.volumeRatio.toFixed(2)}x`]
  ].map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join("");

  el("reasons").innerHTML = r.reasons.map(reason => `<li>${reason}</li>`).join("");
  drawChart(r);
}

function drawChart(r) {
  if (typeof Chart === "undefined") {
    setStatus("資料已分析完成，但 Chart.js 載入失敗。請確認瀏覽器可連到 cdn.jsdelivr.net。");
    return;
  }
  const labels = r.candles.map(c => new Date(c.time).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: r.interval === "1d" ? undefined : "2-digit" }));
  const datasets = [
    { label: "Close", data: r.closes, borderWidth: 2, pointRadius: 0, tension: .25 },
    { label: "SMA20", data: r.sma20Arr, borderWidth: 1.5, pointRadius: 0, tension: .25 },
    { label: "SMA50", data: r.sma50Arr, borderWidth: 1.5, pointRadius: 0, tension: .25 },
    { label: "Entry", data: labels.map(() => r.entry), borderWidth: 1, pointRadius: 0, borderDash: [6, 6] },
    { label: "Stop", data: labels.map(() => r.stop), borderWidth: 1, pointRadius: 0, borderDash: [6, 6] },
    { label: "TP2", data: labels.map(() => r.tp2), borderWidth: 1, pointRadius: 0, borderDash: [6, 6] }
  ];
  if (priceChart) priceChart.destroy();
  priceChart = new Chart(el("priceChart"), {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { color: "#d8e2f2" } } },
      scales: {
        x: { ticks: { color: "#93a4bd", maxTicksLimit: 8 }, grid: { color: "rgba(255,255,255,.06)" } },
        y: { ticks: { color: "#93a4bd" }, grid: { color: "rgba(255,255,255,.06)" } }
      }
    }
  });
}

function renderCoinOptions() {
  el("coinSelect").innerHTML = COINS.map(c => `<option value="${c.symbol}">${c.rank}. ${c.name} (${c.symbol})</option>`).join("");
  renderScannerPlaceholder();
}

function renderScannerPlaceholder() {
  el("scannerBody").innerHTML = COINS.map(c => `<tr data-symbol="${c.symbol}">
    <td>${c.rank}</td><td>${c.name} <small>${c.symbol}</small></td><td colspan="9" class="warn">尚未掃描，請按「掃描 20 個主流幣」</td>
  </tr>`).join("");
  el("scannerBody").querySelectorAll("tr").forEach(row => row.addEventListener("click", () => {
    el("coinSelect").value = row.dataset.symbol;
    analyzeSelected();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));
}

async function analyzeSymbol(symbol) {
  const coin = COINS.find(c => c.symbol === symbol) || { rank: "—", name: symbol, symbol };
  const market = el("marketSelect").value;
  const interval = el("intervalSelect").value;
  const marketData = await loadMarketData(symbol, market, interval);
  return analyzeTechnical(coin, marketData, market, interval);
}

async function analyzeSelected() {
  const symbol = el("coinSelect").value || "BTC";
  setStatus(`正在分析 ${symbol}/USDT，資料源順序：Binance → Bybit → OKX...`);
  try {
    const result = await analyzeSymbol(symbol);
    renderResult(result);
    setStatus(`分析完成。實際資料源：${result.provider}。請把結果視為交易計畫草稿，實際進場前仍需確認交易所盤口、滑價與消息風險。`);
  } catch (err) {
    console.error(err);
    setStatus(`分析失敗：${humanFetchError(err)}`);
    el("decisionBadge").className = "badge error";
    el("decisionBadge").textContent = "資料取得失敗";
  }
}

function directionBadge(r) {
  const cls = r.side === "LONG" ? "long" : r.side === "SHORT" ? "short" : "wait";
  const label = r.side === "LONG" ? "偏多" : r.side === "SHORT" ? "偏空" : "觀望";
  return `<span class="badge ${cls}">${label}</span>`;
}

async function scanAllCoins() {
  const market = el("marketSelect").value;
  const interval = el("intervalSelect").value;
  setStatus(`正在掃描 20 個主流幣｜${market === "futures" ? "合約" : "現貨"}｜${INTERVALS[interval].label} K 線...`);
  const results = [];
  const failures = [];
  el("scannerBody").innerHTML = `<tr><td colspan="11" class="warn">掃描中，會依序嘗試 Binance → Bybit → OKX...</td></tr>`;

  for (let i = 0; i < COINS.length; i++) {
    const coin = COINS[i];
    setStatus(`掃描中 ${i + 1}/${COINS.length}：${coin.symbol}/USDT...`);
    try {
      const marketData = await loadMarketData(coin.symbol, market, interval);
      const result = analyzeTechnical(coin, marketData, market, interval);
      results.push(result);
    } catch (err) {
      failures.push({ coin, error: humanFetchError(err) });
    }
    await sleep(120);
  }

  results.sort((a, b) => Math.max(b.longScore, b.shortScore) - Math.max(a.longScore, a.shortScore));
  el("scannerBody").innerHTML = results.map((r, i) => `<tr data-symbol="${r.coin.symbol}">
    <td>${i + 1}</td>
    <td>${r.coin.name} <small>${r.coin.symbol}</small></td>
    <td><span class="source-pill">${r.provider}</span></td>
    <td>${fmtUSD(r.close)}</td>
    <td class="${r.change24 >= 0 ? "good" : "bad"}">${fmtPct(r.change24)}</td>
    <td>${directionBadge(r)}</td>
    <td>${r.longScore}</td>
    <td>${r.shortScore}</td>
    <td>${fmtUSD(r.entry)}</td>
    <td>${fmtUSD(r.stop)}</td>
    <td>${fmtUSD(r.tp2)}</td>
  </tr>`).join("") + failures.map(f => `<tr data-symbol="${f.coin.symbol}"><td>—</td><td>${f.coin.name} <small>${f.coin.symbol}</small></td><td colspan="9" class="bad">無法取得資料：${f.error}</td></tr>`).join("");

  el("scannerBody").querySelectorAll("tr[data-symbol]").forEach(row => row.addEventListener("click", () => {
    el("coinSelect").value = row.dataset.symbol;
    analyzeSelected();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));
  setStatus(`掃描完成：成功 ${results.length} 個，失敗 ${failures.length} 個。結果已依 Long/Short 最高分排序。`);
}

function setStatus(text) { el("status").textContent = text; }

el("analyzeBtn").addEventListener("click", analyzeSelected);
el("refreshBtn").addEventListener("click", analyzeSelected);
el("scanBtn").addEventListener("click", scanAllCoins);
el("coinSelect").addEventListener("change", analyzeSelected);
el("marketSelect").addEventListener("change", analyzeSelected);
el("intervalSelect").addEventListener("change", analyzeSelected);
el("accountInput").addEventListener("change", () => lastResult && renderResult(lastResult));
el("riskSelect").addEventListener("change", () => lastResult && renderResult(lastResult));

renderCoinOptions();
analyzeSelected();
