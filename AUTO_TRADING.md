# 不用看盤自動交易：建議架構

這個 GitHub Pages 網站是前端分析工具，不能安全地直接保存 OKX API Key。

## 方案 1：手動安全版

網站掃描 Top 3 → 複製一行下單參數 → 打開 OKX → 手動填入並確認。

適合新手與小本金。

## 方案 2：半自動通知版

Cloudflare Worker 或 VPS 每 15～60 分鐘執行一次策略：

1. 讀 OKX K 線
2. 跑同一套小本金保守策略
3. 若出現 A 級訊號，發 Telegram / LINE 通知
4. 使用者手動到 OKX 下單

這是我最推薦的不用盯盤方式。

## 方案 3：全自動交易版

Cloudflare Worker / VPS 儲存 API Key，出現 A 級訊號後自動送出 OKX 訂單。

必須加上安全限制：

- API Key 只開 Read + Trade
- 不開 Withdraw
- 盡量使用 OKX 子帳戶
- 綁定固定 IP
- 每日最大虧損限制
- 連續虧損停止交易
- 禁止沒有止損的訂單
- 單筆風險上限 0.5%

小本金新手不建議直接跳到全自動真錢交易。先用 Demo / Paper Trading 跑至少 2～4 週。
