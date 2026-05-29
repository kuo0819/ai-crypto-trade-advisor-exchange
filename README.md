# AI Crypto Trade Advisor — 交易所 K 線版

這版不再依賴 CoinGecko。資料源順序：

1. Binance
2. Bybit
3. OKX

每次分析某個幣種時，網站會先抓 Binance 的 USDT K 線；如果失敗，就自動改抓 Bybit；如果 Bybit 也失敗，再改抓 OKX。

## 使用方式

建議用本機伺服器開啟，不要直接雙擊 index.html：

```bash
python -m http.server 8000
```

然後用瀏覽器打開：

```text
http://localhost:8000
```

## 功能

- 選擇幣種
- 選擇現貨 Spot 或合約 Futures / Swap
- 選擇 1H / 4H / 1D K 線
- 自動計算：
  - SMA20
  - SMA50
  - EMA20
  - RSI14
  - ATR14
  - 支撐 / 壓力
  - 量能比
  - 風險報酬比
- 輸出：
  - 是否可觀察進場
  - Long / Short / Wait
  - 理想進場價
  - 止損價
  - TP1 / TP2 / TP3
  - 建議倉位
- 可掃描 20 個主流幣，依 AI 多空分數排序。

## 注意事項

這是交易輔助工具，不是保證獲利系統。合約與槓桿可能造成快速虧損。實際下單前，請確認交易所盤口、滑價、流動性、新聞事件與自己的風險承受能力。
