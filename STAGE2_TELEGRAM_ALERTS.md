# 階段 2：不用一直看盤的 Telegram 自動提醒

這一版不是自動下單，而是：

```text
Cloudflare Worker 定時掃描 OKX
→ 找到小本金保守模式 A 級訊號
→ 最多推送 Top 3 到 Telegram
→ 你打開 OKX 手動確認下單
```

這是小本金比較安全的半自動方式：不用一直盯盤，但最後仍由你確認是否下單。

---

## 你會收到什麼訊息？

Telegram 會收到類似這樣：

```text
⚙️ OKX 小本金保守策略提醒
週期：4H｜BTC 大盤偏多
規則：只提醒 A 級訊號｜單筆風險 0.50%｜槓桿 1x

#1 SOL-USDT-SWAP｜做多 Long
OKX：逐倉 1x｜限價｜開多
進場區：168.20 - 169.10
止損 SL：164.80
TP1：171.50 出 50%
TP2：174.90 出 30%
TP3：178.30 出 20%
建議名義倉位：18.50 USDT
預估保證金：18.50 USDT
風險：打到止損約虧 0.50 USDT
```

你只要照訊息去 OKX 填欄位即可。

---

## 第 1 步：建立 Telegram Bot

1. 打開 Telegram，搜尋 `@BotFather`
2. 輸入 `/newbot`
3. 依照指示建立 bot
4. BotFather 會給你一串 `TELEGRAM_BOT_TOKEN`
5. 開啟你建立的 bot，先傳一則訊息給它，例如 `hi`
6. 用下面網址取得 chat id：

```text
https://api.telegram.org/bot你的BOT_TOKEN/getUpdates
```

找到回傳 JSON 裡面的：

```json
"chat":{"id":123456789}
```

這個 `123456789` 就是 `TELEGRAM_CHAT_ID`。

---

## 第 2 步：部署 Cloudflare Worker

先安裝 Node.js，然後在 `cloudflare-worker` 資料夾內執行：

```bash
npm create cloudflare@latest
npm install -g wrangler
wrangler login
```

你也可以直接用這個資料夾裡的 `worker.js` 和 `wrangler.toml`。

部署指令：

```bash
cd cloudflare-worker
wrangler deploy
```

---

## 第 3 步：設定 Telegram Secret

在 `cloudflare-worker` 資料夾執行：

```bash
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
wrangler secret put NOTIFY_SECRET
```

`NOTIFY_SECRET` 是你手動測試 `/scan` 時用的密碼，可以自己設定一長串亂碼。

---

## 第 4 步：避免重複通知，建議開 KV

建立 KV：

```bash
wrangler kv namespace create SIGNAL_KV
```

它會回傳類似：

```text
id = "xxxxxxxxxxxxxxxxxxxx"
```

把它貼到 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "SIGNAL_KV"
id = "xxxxxxxxxxxxxxxxxxxx"
```

再部署一次：

```bash
wrangler deploy
```

---

## 第 5 步：測試

部署後你會得到一個 Worker 網址，例如：

```text
https://okx-small-cap-stage2-alerts.yourname.workers.dev
```

健康檢查：

```text
https://你的-worker網址/health
```

手動掃描：

```text
https://你的-worker網址/scan?secret=你的NOTIFY_SECRET
```

如果目前有 A 級訊號，就會發 Telegram。沒有訊號時，網址會回傳 JSON，顯示 `sent: 0`。

---

## 預設策略設定

`wrangler.toml` 預設：

```toml
BAR = "4H"
ACCOUNT_USDT = "100"
RISK_PCT = "0.005"
LEVERAGE = "1"
MIN_RR = "2"
MIN_SCORE = "78"
MAX_ALERTS = "3"
```

意思是：

```text
4H K 線
帳戶以 100 USDT 試算
單筆最大虧損 0.5%
槓桿 1x
只提醒 A 級訊號
最多推送 3 個推薦幣
```

你的本金約 3000 TWD，如果換算接近 100 USDT，這組設定比較保守。

---

## 可以調整哪些東西？

### 想更少通知

把 `MIN_SCORE` 提高：

```toml
MIN_SCORE = "82"
```

或改成 4 小時掃一次：

```toml
[triggers]
crons = ["0 */4 * * *"]
```

### 想只掃幾個幣

加入：

```toml
SYMBOLS = "BTC-USDT-SWAP,ETH-USDT-SWAP,SOL-USDT-SWAP"
```

### 想更保守

```toml
RISK_PCT = "0.003"
LEVERAGE = "1"
MIN_SCORE = "85"
```

---

## 重要安全提醒

這版不需要 OKX API Key，因為它只讀公開市場資料，不會下單。

請不要把 OKX API Key 放在 GitHub Pages 或前端 JavaScript 裡。

這個階段的目標是：

```text
自動掃描
自動通知
你手動確認
```

不要直接跳到全自動真錢下單。

## Pro Conservative v2 策略更新

這版策略更偏向小本金防守，不追求訊號數量，而是先過濾掉容易被洗掉的盤。

新增規則：

- 只使用已收線 K 線，避免未完成 K 線造成假訊號。
- 加入 1D 日線方向確認，日線逆風時不提醒。
- 加入 BTC 大盤濾網，BTC 方向不一致時只接受更強訊號。
- 加入 ADX 趨勢強度過濾，盤整盤不提醒。
- 加入均線糾纏過濾，SMA20 / SMA50 太接近時不提醒。
- 加入資金費率過濾，做多成本或做空成本太不划算時不提醒。
- 進場價改為回踩區，不用即時價格追單。
- 去重 key 改為 `幣種 + 方向 + 週期`，避免價格微動造成重複推播。

建議參數：

```toml
MIN_SCORE = "82"
MIN_ADX = "16"
MAX_STOP_PCT = "3.2"
FUNDING_LIMIT_PCT = "0.06"
DEDUPE_TTL_SECONDS = "43200"
```

如果提醒太少，可以先把 `MIN_SCORE` 降到 `80`；如果提醒太多，改成 `85`。
