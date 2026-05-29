# AI OKX 新手交易助手

這是一個可部署到 GitHub Pages 的純前端網站，使用 OKX 公開市場資料 API 取得 USDT 永續合約 K 線，並用新手看得懂的方式輸出：

- 現在做多、做空，還是等待
- 進場區
- 止損價
- TP1 / TP2 / TP3
- 風險報酬比
- 建議名義倉位與保證金
- 白話原因
- 主流幣掃描器

## 預設參數

- 交易所：OKX
- 市場：USDT 永續合約，例如 `BTC-USDT-SWAP`
- K 線週期：4H
- 單筆風險：1%
- 槓桿：2x
- 最低風險報酬比：2
- 均線：SMA20 / SMA50
- RSI：14
- ATR：14

## GitHub Pages 部署

1. 建立 GitHub repository。
2. 上傳這些檔案到 repository 根目錄：
   - `index.html`
   - `styles.css`
   - `app.js`
   - `.nojekyll`
   - `404.html`
3. 到 repository 的 `Settings` → `Pages`。
4. Source 選 `Deploy from a branch`。
5. Branch 選 `main`，資料夾選 `/root`。
6. 儲存後等待 GitHub 產生網址。

## 注意事項

- 這個網站不需要 API Key。
- 這個網站不會自動下單。
- 如果瀏覽器或網路阻擋 OKX API，可能會顯示連線失敗。
- 這是交易輔助工具，不保證獲利。
- 合約與槓桿會放大虧損，請務必使用止損。
