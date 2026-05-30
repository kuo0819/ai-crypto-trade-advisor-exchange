# AI OKX Friend Safe Pro v2 朋友分享版

這版適合分享給朋友做「觀察與紙上交易」，不是保證獲利工具。

新增保護：

- 網站首頁加入朋友分享版風險提醒
- 安全模式：單筆風險 0.5%，新手上限 1%
- 合約槓桿只建議 1x～2x
- 紙上交易紀錄：可記錄訊號、結果、損益
- 每日停手機制：連虧 2 筆或虧損達 2R，網站會提醒今日停止交易
- Telegram 訊息底部加入風險提醒與紙上交易建議
- 網站與 Cloudflare Worker 維持 Pro Conservative v2 同步策略

朋友使用建議：

1. 先觀察 Telegram 與網站 Top 3 至少 2 週。
2. 每次訊號先記錄成紙上交易，不急著真錢下單。
3. 真錢測試時只用小額、逐倉、1x～2x。
4. 沒有止損就不下單。
5. 連虧 2 筆或當日虧損達 2R，當天停止交易。

---

# AI OKX 工業風下單參數助手

這是一個可部署到 GitHub Pages 的靜態網站，用 OKX 公開市場資料輔助新手判斷交易參數。

## 功能

- OKX 合約 / 現貨分開顯示
- 工業風暗色儀表板介面
- 一眼看懂：現在做不做、做多 / 做空 / 等待
- 直接對應 OKX 下單欄位：交易對、逐倉、槓桿、限價、價格、數量、止損、TP1/TP2/TP3
- 風險試算：單筆最大虧損、建議倉位、保證金
- 策略模擬：用目前參數回測最近 K 線，估算過去可能獲利或損失
- 主流幣掃描器
- 可直接部署到 GitHub Pages

## 部署到 GitHub Pages

1. 建立 GitHub repository
2. 把本資料夾所有檔案上傳到 repository 根目錄
3. 到 Settings → Pages
4. Source 選 Deploy from a branch
5. Branch 選 main，資料夾選 `/root`
6. 等待 GitHub 產生網址


## Pro Conservative v2 同步策略

這版已把 GitHub Pages 網站與 Cloudflare Worker 的策略同步，避免 Telegram 推播和網站分析出現不同結論。

同步內容：

- 只使用 OKX 已收線 K 線，降低未收線假訊號
- BTC 4H + 1D 大盤濾網
- 單幣 1D 日線方向確認
- ADX 趨勢強度過濾，盤整時不提醒
- SMA20 / SMA50 糾纏過濾
- 資金費率過濾，避免合約持倉成本太高
- 進場價改成回踩區，不追即時價
- Top 3 排序與 Worker 的評分邏輯一致
- Worker KV 去重 key 使用：幣種 + 方向 + 週期

建議設定：

```toml
BAR = "4H"
RISK_PCT = "0.005"
LEVERAGE = "1"
MIN_RR = "2"
MIN_SCORE = "82"
MIN_ADX = "16"
MAX_STOP_PCT = "3.2"
FUNDING_LIMIT_PCT = "0.06"
DEDUPE_TTL_SECONDS = "43200"
```

Cloudflare Worker 的 KV binding 請使用：

```toml
[[kv_namespaces]]
binding = "SIGNAL_KV"
id = "你的 KV namespace id"
```

## 風險提醒

本工具只做技術分析與歷史模擬輔助，不是投資建議，也不能保證獲利。回測結果不代表未來結果。合約、槓桿與加密貨幣交易可能造成快速虧損。請務必使用止損並控制單筆風險。

## 本版新增：Top 3 推薦與 OKX 快速操作

- 開啟網站後會自動掃描 OKX 主流幣，最多顯示 3 個優先觀察機會。
- Top 3 會根據多空分數、是否有合格進場計畫、風險報酬與簡易歷史模擬排序。
- 點「套用這個幣」會自動切換到該交易對並產生 OKX 下單欄位。
- 「複製一行下單參數」會把交易對、方向、逐倉/槓桿、限價區、數量、SL、TP1/TP2/TP3 整理成一行，方便貼到備忘錄或對照 OKX。
- 「開啟 OKX 交易頁」只會開啟 OKX 對應交易頁，不會自動下單。

### 為什麼不能直接從 GitHub Pages 自動下單？

GitHub Pages 是純前端靜態網站。如果把 OKX API Key 放在前端，任何人都能看到你的金鑰，風險很高。因此本網站只做「參數產生、複製、開啟 OKX」。如果未來要做真正一鍵下單，應改成後端或 Cloudflare Worker，並加上簽名、權限、二次確認與風控限制。

## 本版新增：小本金保守模式

預設參數：

- 4H K 線
- 單筆風險 0.5%
- 合約 1x 槓桿
- TP1 出 50%，TP2 出 30%，TP3 出 20%
- 只顯示 A 級機會
- BTC 大盤不配合時不推薦山寨幣逆勢交易

## 自動交易

本專案的 GitHub Pages 版本不會保存 API Key，也不會直接自動下單。若要不用看盤，可以參考 `AUTO_TRADING.md`：

1. 半自動通知：最推薦
2. 全自動交易：需後端與嚴格風控

---

## 階段 2：Telegram 自動提醒

這版已新增 `cloudflare-worker/` 資料夾，可部署到 Cloudflare Worker，讓系統每 4 小時收線後 5 分鐘自動掃描 OKX，出現小本金保守模式 A 級訊號時發 Telegram 通知。

詳細教學請看：

```text
STAGE2_TELEGRAM_ALERTS.md
```

核心流程：

```text
Cloudflare Worker 定時掃描 OKX
→ 最多挑出 Top 3 A 級訊號
→ 發 Telegram 通知
→ 你到 OKX 手動確認下單
```

這版沒有自動下單，不需要 OKX API Key，也不要把任何交易所 API Key 放進 GitHub Pages。
