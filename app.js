const CONTRACT_SYMBOLS = [
  ['BTC-USDT-SWAP','Bitcoin'], ['ETH-USDT-SWAP','Ethereum'], ['SOL-USDT-SWAP','Solana'],
  ['XRP-USDT-SWAP','XRP'], ['DOGE-USDT-SWAP','Dogecoin'], ['ADA-USDT-SWAP','Cardano'],
  ['AVAX-USDT-SWAP','Avalanche'], ['LINK-USDT-SWAP','Chainlink'], ['DOT-USDT-SWAP','Polkadot'],
  ['LTC-USDT-SWAP','Litecoin'], ['BCH-USDT-SWAP','Bitcoin Cash'], ['TRX-USDT-SWAP','TRON'],
  ['NEAR-USDT-SWAP','NEAR'], ['APT-USDT-SWAP','Aptos'], ['OP-USDT-SWAP','Optimism'],
  ['ARB-USDT-SWAP','Arbitrum'], ['FIL-USDT-SWAP','Filecoin'], ['ETC-USDT-SWAP','Ethereum Classic'],
  ['SUI-USDT-SWAP','Sui'], ['TON-USDT-SWAP','Toncoin']
];

const SPOT_SYMBOLS = CONTRACT_SYMBOLS.map(([id, name]) => [id.replace('-SWAP', ''), name]);
const $ = id => document.getElementById(id);
let chart;
let lastAnalysis = null;

function fmtPrice(n){
  if(!Number.isFinite(n)) return '—';
  if(Math.abs(n)>=1000) return n.toLocaleString(undefined,{maximumFractionDigits:2});
  if(Math.abs(n)>=1) return n.toLocaleString(undefined,{maximumFractionDigits:4});
  return n.toLocaleString(undefined,{maximumSignificantDigits:6});
}
function fmtUSD(n){ return Number.isFinite(n) ? `${fmtPrice(n)} USDT` : '—'; }
function fmtPct(n){ return Number.isFinite(n) ? `${n>=0?'+':''}${n.toFixed(2)}%` : '—'; }
function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function toSpotInstId(instId){ return instId.replace('-SWAP',''); }
function toSwapInstId(instId){ return instId.endsWith('-SWAP') ? instId : `${instId}-SWAP`; }
function baseCoin(instId){ return instId.split('-')[0]; }
function currentSymbols(){ return $('marketSelect').value === 'spot' ? SPOT_SYMBOLS : CONTRACT_SYMBOLS; }

function setStatus(msg, type='info'){
  const s=$('status'); s.textContent=msg;
  s.style.borderColor = type==='error' ? 'rgba(255,93,115,.4)' : 'rgba(101,182,255,.25)';
  s.style.background = type==='error' ? 'rgba(255,93,115,.09)' : 'rgba(101,182,255,.1)';
}

async function fetchJson(url, timeout=12000){
  const ctrl = new AbortController();
  const timer = setTimeout(()=>ctrl.abort(), timeout);
  try{
    const res = await fetch(url, {signal:ctrl.signal, cache:'no-store', mode:'cors'});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }finally{ clearTimeout(timer); }
}

async function getCandles(instId, bar='4H', limit=200){
  const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${encodeURIComponent(bar)}&limit=${limit}`;
  const json = await fetchJson(url);
  if(String(json.code)!=='0' || !Array.isArray(json.data) || !json.data.length){
    throw new Error(json.msg || 'OKX 沒有回傳 K 線資料');
  }
  return json.data.map(r=>({
    time:Number(r[0]), open:Number(r[1]), high:Number(r[2]), low:Number(r[3]), close:Number(r[4]),
    volume:Number(r[7] || r[5] || 0), confirm:String(r[8] ?? '1')
  })).filter(c=>[c.open,c.high,c.low,c.close].every(Number.isFinite)).sort((a,b)=>a.time-b.time);
}

async function getTicker(instId){
  const url = `https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`;
  const json = await fetchJson(url).catch(()=>null);
  const t = json?.data?.[0];
  if(!t) return {};
  const last = Number(t.last), open24h = Number(t.open24h);
  return { last, change24h: open24h ? (last-open24h)/open24h*100 : NaN, volCcy24h:Number(t.volCcy24h) };
}

function sma(values, period){
  return values.map((_,i)=>{
    if(i<period-1) return null;
    const slice = values.slice(i-period+1,i+1);
    return slice.reduce((a,b)=>a+b,0)/period;
  });
}
function rsi(values, period=14){
  if(values.length<period+2) return NaN;
  let gains=0, losses=0;
  for(let i=values.length-period;i<values.length;i++){
    const d = values[i]-values[i-1];
    if(d>=0) gains+=d; else losses+=Math.abs(d);
  }
  const avgGain=gains/period, avgLoss=losses/period;
  if(avgLoss===0) return 100;
  return 100 - 100/(1+avgGain/avgLoss);
}
function atr(candles, period=14){
  if(candles.length<period+2) return NaN;
  const trs=[];
  for(let i=1;i<candles.length;i++){
    const c=candles[i], p=candles[i-1];
    trs.push(Math.max(c.high-c.low, Math.abs(c.high-p.close), Math.abs(c.low-p.close)));
  }
  return trs.slice(-period).reduce((a,b)=>a+b,0)/period;
}
function pct(a,b){ return a ? (b-a)/a*100 : 0; }
function levels(candles){
  const look = candles.slice(-42);
  const recent = candles.slice(-10);
  return {
    support: Math.min(...look.map(c=>c.low)),
    resistance: Math.max(...look.map(c=>c.high)),
    recentLow: Math.min(...recent.map(c=>c.low)),
    recentHigh: Math.max(...recent.map(c=>c.high))
  };
}
function volumeRatio(candles){
  const vols = candles.map(c=>c.volume).filter(Number.isFinite);
  const last = vols.at(-1);
  const avg = vols.slice(-21,-1).reduce((a,b)=>a+b,0)/Math.max(1,vols.slice(-21,-1).length);
  return avg ? last/avg : NaN;
}

function makePlan(side, price, atrV, lev, account, riskPct, minRR, lvls, market='swap'){
  if(side==='LONG'){
    const entryMid = price;
    const entryLow = price - atrV*0.25;
    const entryHigh = price + atrV*0.10;
    const structureStop = lvls.recentLow - atrV*0.2;
    const atrStop = entryMid - atrV*1.25;
    const stop = Math.min(structureStop, atrStop);
    const risk = Math.max(entryMid-stop, atrV*0.8);
    return finalizePlan(side, entryLow, entryHigh, entryMid, stop, risk, lev, account, riskPct, minRR, market);
  }
  if(side==='SHORT'){
    const entryMid = price;
    const entryLow = price - atrV*0.10;
    const entryHigh = price + atrV*0.25;
    const structureStop = lvls.recentHigh + atrV*0.2;
    const atrStop = entryMid + atrV*1.25;
    const stop = Math.max(structureStop, atrStop);
    const risk = Math.max(stop-entryMid, atrV*0.8);
    return finalizePlan(side, entryLow, entryHigh, entryMid, stop, risk, lev, account, riskPct, minRR, market);
  }
  return null;
}
function finalizePlan(side, entryLow, entryHigh, entryMid, stop, risk, lev, account, riskPct, minRR, market){
  const dir = side==='LONG' ? 1 : -1;
  const tp1 = entryMid + dir*risk;
  const tp2 = entryMid + dir*risk*2;
  const tp3 = entryMid + dir*risk*3;
  const riskCash = account*riskPct;
  const qtyCoin = risk > 0 ? riskCash / risk : 0;
  let notional = qtyCoin * entryMid;
  if(market === 'spot') notional = Math.min(notional, account * 0.35); // 新手現貨避免一次買太滿
  const margin = lev > 0 ? notional / lev : notional;
  const stopPct = Math.abs(entryMid-stop)/entryMid*100;
  const trailingCallback = clamp(Math.round((stopPct * 0.7) * 10) / 10, 2, 10);
  return {side, entryLow, entryHigh, entryMid, stop, tp1, tp2, tp3, risk, rr: 2, qtyCoin, notional, margin, minRR, stopPct, trailingCallback};
}

function analyzeFromCandles(instId, candles, ticker={}){
  const market = $('marketSelect').value;
  const account = Number($('accountInput').value || 1000);
  const riskPct = Number($('riskSelect').value || .01);
  const lev = market === 'spot' ? 1 : Number($('leverageSelect').value || 2);
  const minRR = Number($('rrSelect').value || 2);
  const mode = $('modeSelect').value;
  const closes = candles.map(c=>c.close);
  const s20 = sma(closes,20), s50=sma(closes,50);
  const price = Number.isFinite(ticker.last) ? ticker.last : closes.at(-1);
  const sma20 = s20.at(-1), sma50=s50.at(-1);
  const rsi14 = rsi(closes,14);
  const atr14 = atr(candles,14);
  const atrPct = atr14 / price * 100;
  const distSma20 = (price-sma20)/price*100;
  const trend10 = pct(closes.at(-11), closes.at(-1));
  const trend30 = pct(closes.at(-31), closes.at(-1));
  const lvls = levels(candles);
  const volR = volumeRatio(candles);

  let long=0, short=0;
  const reasonsLong=[], reasonsShort=[], warnings=[];
  if(price>sma20){ long+=15; reasonsLong.push('價格在短期平均線上方，短線偏強。'); } else { short+=15; reasonsShort.push('價格在短期平均線下方，短線偏弱。'); }
  if(price>sma50){ long+=15; reasonsLong.push('價格在中期平均線上方，大方向比較偏多。'); } else { short+=15; reasonsShort.push('價格在中期平均線下方，大方向比較偏空。'); }
  if(sma20>sma50){ long+=20; reasonsLong.push('短期平均線高於中期平均線，趨勢偏上。'); } else { short+=20; reasonsShort.push('短期平均線低於中期平均線，趨勢偏下。'); }
  if(rsi14>=45 && rsi14<=68){ long+=14; reasonsLong.push('RSI 偏強但還沒過熱，做多條件較健康。'); }
  if(rsi14>=32 && rsi14<=55){ short+=14; reasonsShort.push('RSI 偏弱但還沒嚴重超賣，做空條件較健康。'); }
  if(trend10>0 && trend30>0){ long+=12; reasonsLong.push('最近價格有往上推進。'); }
  if(trend10<0 && trend30<0){ short+=12; reasonsShort.push('最近價格有往下推進。'); }
  if(volR>=0.8){ long+=6; short+=6; } else warnings.push('最近成交量偏低，訊號可信度會下降。');
  if(Math.abs(distSma20) < atrPct*1.8){ long+=8; short+=8; } else warnings.push('價格離短期平均線太遠，容易追高或追低。');
  if(rsi14>75) warnings.push('RSI 過熱，新手不建議追多，等回踩比較安全。');
  if(rsi14<25) warnings.push('RSI 過度超賣，新手不建議追空，等反彈比較安全。');
  if(atrPct>8) warnings.push('目前波動很大，建議降低倉位或槓桿。');

  long = clamp(Math.round(long),0,100);
  short = clamp(Math.round(short),0,100);

  let side='WAIT', label='等待，不交易', grade='wait';
  const threshold = mode==='conservative' ? 72 : 64;
  if(long>=threshold && long>=short+10 && rsi14<75) { side='LONG'; label='可以觀察做多'; grade='long'; }
  if(short>=threshold && short>=long+10 && rsi14>25) { side='SHORT'; label='可以觀察做空'; grade='short'; }
  if(Math.abs(long-short)<10){ side='WAIT'; label='等待，不交易'; grade='wait'; warnings.push('多空分數太接近，代表方向不夠明確。'); }

  if(market === 'spot' && side === 'SHORT'){
    label = '現貨偏空：不買，持倉可考慮賣出';
    grade = 'short';
    warnings.push('現貨不能真正做空；偏空時新手不要開新倉買入。');
  }

  let plan = side==='WAIT' ? null : makePlan(side, price, atr14, lev, account, riskPct, minRR, lvls, market);
  if(market === 'spot' && side === 'SHORT') plan = makePlan('SHORT', price, atr14, 1, account, riskPct, minRR, lvls, market);
  if(plan){
    const rrOk = plan.rr >= minRR;
    if(!rrOk){ side='WAIT'; label='等待，不交易'; grade='wait'; warnings.push(`風險報酬比低於 ${minRR}，不符合新手交易條件。`); plan=null; }
  }

  const reasons = side==='LONG' ? reasonsLong : side==='SHORT' ? reasonsShort : warnings.slice(0,3);
  if(side==='WAIT' && reasons.length===0) reasons.push('目前沒有明確方向，先等待比較安全。');
  warnings.forEach(w=>{ if(!reasons.includes(w)) reasons.push(w); });

  return {market, instId, candles, ticker, price, sma20, sma50, rsi14, atr14, atrPct, distSma20, trend10, trend30, lvls, volR, long, short, side, label, grade, plan, reasons, s20, s50, account, riskPct, lev, minRR};
}

async function analyzeSelected(){
  const instId = $('symbolSelect').value;
  const bar = $('barSelect').value;
  setBusy(true);
  try{
    setStatus(`正在向 OKX 取得 ${instId} 的 ${bar} K 線資料...`);
    const [candles, ticker] = await Promise.all([getCandles(instId, bar, 200), getTicker(instId)]);
    const analysis = analyzeFromCandles(instId, candles, ticker);
    lastAnalysis = analysis;
    renderAnalysis(analysis);
    setStatus(`分析完成：${instId}｜資料來源 OKX Public API｜${bar} K 線`);
  }catch(err){
    console.error(err);
    setStatus(`初始化失敗：${err.message || err}。請確認網路、瀏覽器是否允許連線 OKX API，或稍後再試。`, 'error');
  }finally{ setBusy(false); }
}

function setBusy(b){ ['analyzeBtn','scanBtn','refreshBtn'].forEach(id=>$(id).disabled=b); }

function renderAnalysis(a){
  $('updatedAt').textContent = new Date().toLocaleString('zh-TW');
  $('symbolTitle').textContent = `${a.instId}｜現價 ${fmtUSD(a.price)}`;
  $('decisionBadge').textContent = a.label;
  $('decisionBadge').className = `decision ${a.grade}`;
  $('simpleConclusion').textContent = simpleText(a);
  $('longScore').textContent = a.long;
  $('shortScore').textContent = a.short;
  $('longBar').style.width = `${a.long}%`;
  $('shortBar').style.width = `${a.short}%`;
  renderPlan(a);
  renderOkxParams(a);
  renderReasons(a.reasons);
  renderMetrics(a);
  renderChart(a);
  renderSimulation(a);
  setupOkxQuickActions(a);
}
function simpleText(a){
  if(a.market==='spot' && a.side==='SHORT') return '現貨沒有做空按鈕。偏空時不要買；如果你已經持有，可以參考現貨參數分批賣出或設止損。';
  if(a.side==='LONG') return '目前偏多，可以等待價格落在進場區附近，再用止損控制風險。不要看到綠色就重倉追高。';
  if(a.side==='SHORT') return '目前偏空，可以觀察合約做空；新手一定要用逐倉和止損，避免反彈造成大虧。';
  return '目前建議等待，不交易。方向不夠明確或風險條件不漂亮時，空手就是最安全的策略。';
}
function renderPlan(a){
  if(!a.plan){
    $('sideOut').textContent='等待';
    ['entryOut','stopOut','tp1Out','tp2Out','tp3Out','rrOut','positionOut','marginOut'].forEach(id=>$(id).textContent='—');
    if($('riskSentence')) $('riskSentence').textContent = '目前沒有合格交易計畫，所以不需要填下單參數。等待是保護本金的一部分。';
    return;
  }
  const p=a.plan;
  let sideText = p.side==='LONG' ? (a.market==='spot'?'現貨買入 Buy':'做多 Long') : (a.market==='spot'?'現貨賣出 / 不買':'做空 Short');
  $('sideOut').textContent = sideText;
  $('entryOut').textContent = `${fmtPrice(p.entryLow)} - ${fmtPrice(p.entryHigh)}`;
  $('stopOut').textContent = fmtUSD(p.stop);
  $('tp1Out').textContent = fmtUSD(p.tp1);
  $('tp2Out').textContent = fmtUSD(p.tp2);
  $('tp3Out').textContent = fmtUSD(p.tp3);
  $('rrOut').textContent = `約 1 : ${p.rr.toFixed(1)}`;
  $('positionOut').textContent = `${fmtPrice(p.notional)} USDT 名義倉位`;
  $('marginOut').textContent = a.market==='spot' ? '現貨無槓桿' : `${fmtPrice(p.margin)} USDT，${a.lev}x`;
  if($('riskSentence')){
    const riskCash = a.account * a.riskPct;
    const actionText = p.side === 'LONG' ? (a.market === 'spot' ? '買入' : '開多') : (a.market === 'spot' ? '不買 / 持倉賣出' : '開空');
    $('riskSentence').textContent = `本次建議動作：${actionText}。如果打到止損，預估最多虧約 ${fmtPrice(riskCash)} USDT。`;
  }
}
function paramRows(rows){
  return rows.map(([k,v,hint])=>`<div class="param-row"><small>${escapeHtml(k)}</small><strong>${escapeHtml(v)}</strong>${hint?`<em>${escapeHtml(hint)}</em>`:''}</div>`).join('');
}
function plainRows(rows){
  return rows.map(([k,v,hint])=>`${k}：${v}${hint ? `（${hint}）` : ''}`).join('\n');
}
function setMainTicket(title, rows){
  if($('mainTicketTitle')) $('mainTicketTitle').textContent = title;
  if($('mainTicket')) $('mainTicket').innerHTML = paramRows(rows);
  if($('copyTicketBtn')) $('copyTicketBtn').dataset.copy = plainRows(rows);
}
function renderOkxParams(a){
  const p = a.plan;
  const swapId = toSwapInstId(a.instId);
  const spotId = toSpotInstId(a.instId);
  if(!p){
    const waitRows = [
      ['目前動作','等待，不下單','OKX 任何欄位都先不要填'],
      ['交易類型', a.market==='spot' ? '現貨' : '合約', '保持空手，等下一次訊號'],
      ['委託類型','不要選','目前不是好的進場點'],
      ['價格','不要填','不要硬追單'],
      ['數量','不要填','保留資金'],
      ['止盈止損','暫不設定','沒有進場就不用設'],
      ['下一步','等待重新分析','方向清楚後再操作'],
      ['提醒','空手也是策略','不要為了交易而交易']
    ];
    $('contractParams').innerHTML = paramRows(waitRows);
    $('spotParams').innerHTML = paramRows(waitRows);
    setMainTicket('OKX 下單欄位怎麼填：目前等待', waitRows);
    return;
  }

  const contractAction = p.side === 'LONG' ? '開多' : '開空';
  const contractRows = [
    ['交易對', swapId, 'OKX 合約搜尋這個名稱'],
    ['頁籤', '交易 → 開倉', '不是平倉'],
    ['倉位模式', '逐倉', '新手不要用全倉'],
    ['方向', contractAction, p.side==='LONG'?'綠色開多按鈕':'紅色開空按鈕'],
    ['槓桿', `${a.lev}x`, '新手建議 1x - 2x，最多不要超過 3x'],
    ['委託類型', '限價委託', '不要用市價追單'],
    ['價格欄', `${fmtPrice(p.entryLow)} - ${fmtPrice(p.entryHigh)}`, '價格接近這區間再掛單'],
    ['數量單位', 'USDT', '截圖數量欄右側選 USDT'],
    ['數量', `${fmtPrice(p.notional)} USDT`, '這是名義倉位，不是保證金'],
    ['預估保證金', `${fmtPrice(p.margin)} USDT`, '實際以 OKX 顯示為準'],
    ['止盈止損', '勾選', '一定要設定，不要裸單'],
    ['止損觸發價', fmtPrice(p.stop), '委託價建議選市價'],
    ['TP1 止盈', `${fmtPrice(p.tp1)}｜出 30%`, '先保護利潤'],
    ['TP2 止盈', `${fmtPrice(p.tp2)}｜再出 30%`, '達到後可把止損移到進場價'],
    ['TP3 止盈', `${fmtPrice(p.tp3)}｜出 40%`, '最後一段吃趨勢'],
    ['移動止盈止損', `回調幅度 ${p.trailingCallback}%`, '不懂可以先不用，會用後再開']
  ];

  const spotRows = p.side === 'LONG' ? [
    ['交易對', spotId, 'OKX 現貨搜尋這個名稱'],
    ['操作', '買入', '現貨沒有開多/開空，只有買入/賣出'],
    ['委託類型', '限價委託', '新手不要市價追高'],
    ['買入價格', `${fmtPrice(p.entryLow)} - ${fmtPrice(p.entryHigh)}`, '價格到這區間再買'],
    ['買入金額', `${fmtPrice(Math.min(p.notional, a.account*0.35))} USDT`, '新手單一幣最多先用帳戶 35% 以內'],
    ['止損價', fmtPrice(p.stop), '跌破代表判斷錯誤'],
    ['TP1 賣出', `${fmtPrice(p.tp1)}｜賣 30%`, '可用限價賣單'],
    ['TP2 賣出', `${fmtPrice(p.tp2)}｜賣 30%`, '分批收利潤'],
    ['TP3 賣出', `${fmtPrice(p.tp3)}｜賣 40%`, '留最後一段'],
    ['現貨提醒', '不能做空', '偏空時不要買，已持倉才考慮賣出']
  ] : [
    ['交易對', spotId, 'OKX 現貨搜尋這個名稱'],
    ['操作', '不買 / 有持倉才賣出', '現貨不能真正做空'],
    ['委託類型', '限價賣出或止損賣出', '沒有持倉就不要操作'],
    ['賣出參考價', fmtPrice(p.entryMid), '偏空時不要追買'],
    ['風險線', fmtPrice(p.stop), '若你持有現貨，反彈過這裡代表空方減弱'],
    ['下方目標 1', `${fmtPrice(p.tp1)}｜可觀察`, '這不是做空獲利單，是提醒下方支撐'],
    ['下方目標 2', `${fmtPrice(p.tp2)}｜可觀察`, '現貨新手以保護本金為主'],
    ['下方目標 3', `${fmtPrice(p.tp3)}｜可觀察`, '不要把現貨當合約做空'],
    ['現貨提醒', '偏空 = 不買', '想做空請切到合約並用逐倉止損']
  ];

  $('contractParams').innerHTML = paramRows(contractRows);
  $('spotParams').innerHTML = paramRows(spotRows);
  const isSpot = a.market === 'spot';
  const mainRows = isSpot ? spotRows : contractRows;
  setMainTicket(isSpot ? 'OKX 現貨下單欄位怎麼填' : 'OKX 合約下單欄位怎麼填', mainRows);
}
function renderReasons(reasons){ $('reasons').innerHTML = reasons.map(r=>`<li>${escapeHtml(r)}</li>`).join(''); }
function renderMetrics(a){
  const rows = [
    ['交易類型', a.market==='spot'?'現貨':'USDT 永續合約'], ['現價', fmtUSD(a.price)], ['24H 漲跌', fmtPct(a.ticker.change24h)],
    ['SMA20', fmtUSD(a.sma20)], ['SMA50', fmtUSD(a.sma50)],
    ['RSI14', Number.isFinite(a.rsi14)?a.rsi14.toFixed(1):'—'], ['ATR14', `${fmtUSD(a.atr14)}｜${a.atrPct.toFixed(2)}%`],
    ['支撐', fmtUSD(a.lvls.support)], ['壓力', fmtUSD(a.lvls.resistance)],
    ['10 根 K 趨勢', fmtPct(a.trend10)], ['成交量比', Number.isFinite(a.volR)?`${a.volR.toFixed(2)}x`:'—']
  ];
  $('metrics').innerHTML = rows.map(([k,v])=>`<div><small>${k}</small><strong>${v}</strong></div>`).join('');
}
function renderChart(a){
  const ctx = $('priceChart');
  if(!window.Chart){ $('chartNote').textContent='Chart.js 未載入，但分析仍可使用'; return; }
  const labels = a.candles.slice(-80).map(c=>new Date(c.time).toLocaleDateString('zh-TW',{month:'2-digit',day:'2-digit'}));
  const close = a.candles.slice(-80).map(c=>c.close);
  const s20 = a.s20.slice(-80);
  const s50 = a.s50.slice(-80);
  if(chart) chart.destroy();
  chart = new Chart(ctx, {
    type:'line',
    data:{ labels, datasets:[
      {label:'Close', data:close, borderWidth:2, pointRadius:0, tension:.25},
      {label:'SMA20', data:s20, borderWidth:1.5, pointRadius:0, tension:.25},
      {label:'SMA50', data:s50, borderWidth:1.5, pointRadius:0, tension:.25}
    ]},
    options:{ responsive:true, plugins:{legend:{labels:{color:'#dceaff'}}}, scales:{x:{ticks:{color:'#9fb1ca', maxTicksLimit:8}, grid:{color:'rgba(255,255,255,.05)'}}, y:{ticks:{color:'#9fb1ca'}, grid:{color:'rgba(255,255,255,.06)'}}} }
  });
}

function barHoldLimit(){
  const bar = $('barSelect').value;
  if(bar === '1H') return 24;
  if(bar === '1D') return 14;
  return 18;
}
function tradeSideText(side, market){
  if(side === 'LONG') return market === 'spot' ? '現貨買入' : '合約開多';
  if(side === 'SHORT') return market === 'spot' ? '現貨不交易' : '合約開空';
  return '等待';
}
function simulateOneTrade(signal, futureCandles, maxHold){
  const p = signal.plan;
  if(!p || !futureCandles.length) return null;
  const dir = p.side === 'LONG' ? 1 : -1;
  const entry = futureCandles[0].open;
  const stop = p.stop;
  const targets = [p.tp1, p.tp2, p.tp3];
  const shares = [0.3, 0.3, 0.4];
  const qty = p.qtyCoin;
  const riskCash = signal.account * signal.riskPct;
  const feeRate = signal.market === 'swap' ? 0.0005 : 0.001;
  let remaining = 1;
  let pnl = 0;
  let exitPrice = entry;
  let result = '時間到出場';
  let hit = [false,false,false];
  let hold = 0;
  const slice = futureCandles.slice(0, maxHold);
  for(let i=0;i<slice.length;i++){
    const c = slice[i];
    hold = i + 1;
    const stopHit = p.side === 'LONG' ? c.low <= stop : c.high >= stop;
    const tpHitAny = targets.some((t,idx)=>!hit[idx] && (p.side === 'LONG' ? c.high >= t : c.low <= t));
    // 保守處理：同一根 K 線同時碰到止盈與止損時，先算止損，避免高估績效。
    if(stopHit && tpHitAny){
      pnl += qty * remaining * (stop - entry) * dir;
      exitPrice = stop;
      result = '止損';
      remaining = 0;
      break;
    }
    if(stopHit){
      pnl += qty * remaining * (stop - entry) * dir;
      exitPrice = stop;
      result = '止損';
      remaining = 0;
      break;
    }
    for(let t=0;t<targets.length;t++){
      if(hit[t]) continue;
      const reached = p.side === 'LONG' ? c.high >= targets[t] : c.low <= targets[t];
      if(reached){
        hit[t] = true;
        pnl += qty * shares[t] * (targets[t] - entry) * dir;
        remaining -= shares[t];
        exitPrice = targets[t];
        result = `TP${t+1}`;
      }
    }
    if(remaining <= 0.001){
      remaining = 0;
      result = 'TP3 全部止盈';
      break;
    }
  }
  if(remaining > 0){
    const last = slice.at(-1) || futureCandles.at(-1);
    exitPrice = last.close;
    pnl += qty * remaining * (exitPrice - entry) * dir;
  }
  const grossNotional = Math.abs(qty * entry);
  const fees = grossNotional * feeRate * 2;
  pnl -= fees;
  const rMultiple = riskCash ? pnl / riskCash : 0;
  return {entry, exitPrice, pnl, rMultiple, result, hold, fees};
}
function runSimulation(a){
  const candles = a.candles;
  const maxHold = barHoldLimit();
  const trades = [];
  const start = Math.max(70, candles.length - 150);
  let i = start;
  while(i < candles.length - maxHold - 2){
    const sample = candles.slice(0, i + 1);
    const ticker = {last: sample.at(-1).close, change24h: NaN, volCcy24h: NaN};
    const sig = analyzeFromCandles(a.instId, sample, ticker);
    const tradable = sig.plan && (sig.market === 'swap' || sig.side === 'LONG');
    if(sig.side !== 'WAIT' && tradable){
      const outcome = simulateOneTrade(sig, candles.slice(i + 1), maxHold);
      if(outcome){
        trades.push({
          time: candles[i + 1].time,
          side: sig.side,
          market: sig.market,
          entry: outcome.entry,
          exitPrice: outcome.exitPrice,
          pnl: outcome.pnl,
          rMultiple: outcome.rMultiple,
          result: outcome.result,
          hold: outcome.hold
        });
        i += Math.max(1, outcome.hold);
        continue;
      }
    }
    i += 1;
  }
  let total = 0, peak = 0, maxDD = 0, wins = 0;
  const equity = [];
  for(const t of trades){
    total += t.pnl;
    if(t.pnl > 0) wins++;
    peak = Math.max(peak, total);
    maxDD = Math.min(maxDD, total - peak);
    equity.push(total);
  }
  const avgR = trades.length ? trades.reduce((sum,t)=>sum+t.rMultiple,0)/trades.length : 0;
  return {trades, total, wins, winRate: trades.length ? wins/trades.length*100 : 0, maxDD, avgR, maxHold};
}
function renderSimulation(a){
  const summary = $('simSummary');
  const body = $('simBody');
  if(!summary || !body) return;
  const sim = runSimulation(a);
  if(!sim.trades.length){
    summary.innerHTML = `<div><small>模擬結果</small><strong>沒有出現足夠交易機會</strong><em>最近 K 線沒有符合這套策略的進場條件</em></div>`;
    body.innerHTML = `<tr><td colspan="8" class="muted">這段歷史資料沒有可模擬的進場點。這不代表策略壞掉，可能只是目前行情不適合交易。</td></tr>`;
    $('simExplain').textContent = `使用最近 ${a.candles.length} 根 ${$('barSelect').value} K 線模擬。若沒有交易，代表依照目前參數，過去一段時間多數時候應該等待。`;
    if($('copySimBtn')) $('copySimBtn').dataset.copy = '策略模擬：沒有出現足夠交易機會';
    return;
  }
  const riskCash = a.account * a.riskPct;
  const totalClass = sim.total >= 0 ? 'positive' : 'negative';
  summary.innerHTML = `
    <div><small>總損益</small><strong class="${totalClass}">${sim.total>=0?'+':''}${fmtPrice(sim.total)} USDT</strong><em>以目前帳戶與風險參數估算</em></div>
    <div><small>交易次數</small><strong>${sim.trades.length} 筆</strong><em>最近歷史 K 線模擬</em></div>
    <div><small>勝率</small><strong>${sim.winRate.toFixed(1)}%</strong><em>${sim.wins} 勝 / ${sim.trades.length-sim.wins} 敗</em></div>
    <div><small>平均 R 值</small><strong>${sim.avgR.toFixed(2)}R</strong><em>1R 約 ${fmtPrice(riskCash)} USDT</em></div>
    <div><small>最大回落</small><strong class="negative">${fmtPrice(sim.maxDD)} USDT</strong><em>過程中最不舒服的回撤</em></div>
    <div><small>持倉上限</small><strong>${sim.maxHold} 根 K</strong><em>沒碰 TP/SL 就用時間出場</em></div>
  `;
  const recent = sim.trades.slice(-12).reverse();
  body.innerHTML = recent.map((t,idx)=>{
    const pnlClass = t.pnl >= 0 ? 'positive' : 'negative';
    return `<tr>
      <td>${idx+1}</td>
      <td>${new Date(t.time).toLocaleDateString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
      <td>${tradeSideText(t.side, t.market)}</td>
      <td>${fmtPrice(t.entry)}</td>
      <td>${fmtPrice(t.exitPrice)}</td>
      <td>${escapeHtml(t.result)}</td>
      <td class="${pnlClass}">${t.rMultiple>=0?'+':''}${t.rMultiple.toFixed(2)}R</td>
      <td class="${pnlClass}">${t.pnl>=0?'+':''}${fmtPrice(t.pnl)} USDT</td>
    </tr>`;
  }).join('');
  const verdict = sim.total >= 0 ? '這段歷史資料下，這套參數呈現正報酬。' : '這段歷史資料下，這套參數呈現虧損，建議不要只靠目前設定硬做。';
  $('simExplain').textContent = `${verdict} 模擬方式：每次訊號成立後，下一根 K 線開盤進場，依止損、TP1/TP2/TP3 分批出場；同一根 K 線同時碰到止盈與止損時，用較保守的止損計算。已粗估手續費，未包含滑價與資金費率。`;
  if($('copySimBtn')) $('copySimBtn').dataset.copy = [
    `策略模擬：${a.instId} ${$('barSelect').value}`,
    `總損益：${sim.total>=0?'+':''}${fmtPrice(sim.total)} USDT`,
    `交易次數：${sim.trades.length}`,
    `勝率：${sim.winRate.toFixed(1)}%`,
    `平均 R：${sim.avgR.toFixed(2)}R`,
    `最大回落：${fmtPrice(sim.maxDD)} USDT`,
    `提醒：回測不代表未來保證獲利。`
  ].join('\n');
}


function okxTradeUrl(instId, market){
  const path = market === 'spot' ? 'trade-spot' : 'trade-swap';
  return `https://www.okx.com/trade-${market === 'spot' ? 'spot' : 'swap'}/${String(instId).toLowerCase()}`;
}
function oneLineTicket(a){
  if(!a || !a.plan) return '目前等待，不建議下單。';
  const p = a.plan;
  const action = a.market === 'spot' ? (p.side === 'LONG' ? '現貨買入' : '現貨不買/持倉賣出') : (p.side === 'LONG' ? '合約開多' : '合約開空');
  const inst = a.market === 'spot' ? toSpotInstId(a.instId) : toSwapInstId(a.instId);
  return [
    `OKX ${action}`,
    `交易對 ${inst}`,
    a.market === 'swap' ? `逐倉 ${a.lev}x` : '現貨無槓桿',
    `限價 ${fmtPrice(p.entryLow)}-${fmtPrice(p.entryHigh)}`,
    `數量 ${fmtPrice(p.notional)} USDT`,
    `SL ${fmtPrice(p.stop)}`,
    `TP1 ${fmtPrice(p.tp1)} 出30%`,
    `TP2 ${fmtPrice(p.tp2)} 出30%`,
    `TP3 ${fmtPrice(p.tp3)} 出40%`
  ].join('｜');
}
function setupOkxQuickActions(a){
  const openBtn = $('openOkxBtn');
  const copyBtn = $('copyOkxOneLineBtn');
  if(openBtn){
    openBtn.disabled = !a;
    openBtn.onclick = () => {
      const inst = a?.market === 'spot' ? toSpotInstId(a.instId) : toSwapInstId(a?.instId || $('symbolSelect').value);
      window.open(okxTradeUrl(inst, a?.market || $('marketSelect').value), '_blank', 'noopener,noreferrer');
    };
  }
  if(copyBtn){
    copyBtn.disabled = !a;
    copyBtn.onclick = async () => {
      const text = oneLineTicket(a);
      try{
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = '已複製一行參數';
        setTimeout(()=>copyBtn.textContent='複製一行下單參數', 1200);
      }catch{ alert(text); }
    };
  }
}
function recommendationScore(a){
  if(a.error) return -999;
  if(!a.plan) return Math.max(a.long||0, a.short||0) - 45;
  const directionScore = Math.max(a.long||0, a.short||0);
  const rrBonus = (a.plan.rr || 0) * 8;
  const sim = runSimulation(a);
  const simBonus = sim.trades.length ? Math.max(-18, Math.min(18, sim.avgR * 10 + (sim.winRate - 50) / 4)) : -4;
  const waitPenalty = a.side === 'WAIT' ? -35 : 0;
  const spotShortPenalty = a.market === 'spot' && a.side === 'SHORT' ? -40 : 0;
  return directionScore + rrBonus + simBonus + waitPenalty + spotShortPenalty;
}
function renderTopPicks(results){
  const box = $('topPicks');
  if(!box) return;
  const tradable = results
    .filter(r=>!r.error && r.plan && r.side !== 'WAIT' && !(r.market === 'spot' && r.side === 'SHORT'))
    .sort((a,b)=>recommendationScore(b)-recommendationScore(a))
    .slice(0,3);
  if(!tradable.length){
    box.innerHTML = `<div class="pick-card empty"><strong>目前沒有 A 級機會</strong><span>主流幣沒有符合進場條件，網站建議等待。這不是壞事，空手也是策略。</span></div>`;
    return;
  }
  box.innerHTML = tradable.map((r,idx)=>{
    const p = r.plan;
    const tag = r.side === 'LONG' ? '做多' : '做空';
    const klass = r.side === 'LONG' ? 'long' : 'short';
    const score = Math.round(recommendationScore(r));
    return `<article class="pick-card ${klass}" data-inst="${escapeHtml(r.instId)}">
      <div class="pick-rank">#${idx+1}</div>
      <div class="pick-head"><strong>${escapeHtml(r.instId)}</strong><span>${escapeHtml(tag)}｜分數 ${score}</span></div>
      <div class="pick-grid">
        <div><small>進場區</small><b>${fmtPrice(p.entryLow)} - ${fmtPrice(p.entryHigh)}</b></div>
        <div><small>止損</small><b>${fmtPrice(p.stop)}</b></div>
        <div><small>TP2</small><b>${fmtPrice(p.tp2)}</b></div>
        <div><small>倉位</small><b>${fmtPrice(p.notional)} USDT</b></div>
      </div>
      <p>${escapeHtml(r.reasons?.[0] || '訊號條件較完整。')}</p>
      <button class="ghost pick-use" type="button">套用這個幣</button>
    </article>`;
  }).join('');
  [...box.querySelectorAll('.pick-card[data-inst]')].forEach(card=>{
    const use = () => { $('symbolSelect').value = card.dataset.inst; analyzeSelected(); window.scrollTo({top:0, behavior:'smooth'}); };
    card.querySelector('.pick-use')?.addEventListener('click', use);
  });
}
async function scanTopPicks(silent=false){
  const box = $('topPicks');
  if(box && !silent) box.innerHTML = `<div class="pick-card empty"><strong>掃描中...</strong><span>正在讀取 OKX 主流幣 K 線，最多挑出 3 個推薦觀察。</span></div>`;
  const bar = $('barSelect').value;
  const symbols = currentSymbols();
  const results = [];
  for(let i=0;i<symbols.length;i++){
    const [instId,name] = symbols[i];
    try{
      if(!silent) setStatus(`Top 3 掃描中 ${i+1}/${symbols.length}：${instId}`);
      const [candles,ticker] = await Promise.all([getCandles(instId, bar, 200), getTicker(instId)]);
      const a = analyzeFromCandles(instId, candles, ticker);
      results.push({rank:i+1,name,...a});
      await sleep(70);
    }catch(err){ results.push({rank:i+1,name,instId,error:err.message||String(err)}); }
  }
  renderTopPicks(results);
  if(!silent) setStatus('Top 3 掃描完成。點「套用這個幣」可以直接帶入下單參數。');
  return results;
}

async function scanSymbols(){
  setBusy(true);
  const bar = $('barSelect').value;
  const symbols = currentSymbols();
  const body = $('scanBody');
  body.innerHTML = '';
  setStatus(`正在掃描 OKX ${$('marketSelect').value==='spot'?'現貨':'合約'}主流幣，請稍候...`);
  const results=[];
  for(let i=0;i<symbols.length;i++){
    const [instId,name]=symbols[i];
    setStatus(`掃描中 ${i+1}/${symbols.length}：${instId}`);
    try{
      const [candles,ticker] = await Promise.all([getCandles(instId, bar, 200), getTicker(instId)]);
      const a = analyzeFromCandles(instId, candles, ticker);
      results.push({rank:i+1,name,...a});
      await sleep(80);
    }catch(err){
      results.push({rank:i+1, name, instId, error: err.message || String(err)});
    }
  }
  results.sort((a,b)=> recommendationScore(b) - recommendationScore(a));
  renderTopPicks(results);
  body.innerHTML = results.map((r,idx)=>renderScanRow(r,idx)).join('');
  [...body.querySelectorAll('tr[data-inst]')].forEach(tr=>{
    tr.addEventListener('click',()=>{ $('symbolSelect').value=tr.dataset.inst; analyzeSelected(); window.scrollTo({top:0,behavior:'smooth'}); });
  });
  setStatus('掃描完成。點擊任一列可以切換到該幣種詳細分析。');
  setBusy(false);
}
function renderScanRow(r,idx){
  if(r.error) return `<tr><td>${idx+1}</td><td>${r.instId}</td><td colspan="8" class="negative">資料失敗：${escapeHtml(r.error)}</td></tr>`;
  const tagClass = r.side==='LONG'?'long':r.side==='SHORT'?'short':'wait';
  const p=r.plan;
  const firstReason = r.reasons?.[0] || '—';
  const action = r.market==='spot' ? (r.side==='LONG'?'買入':'不買 / 持倉賣出') : (r.side==='LONG'?'開多':r.side==='SHORT'?'開空':'不下單');
  return `<tr data-inst="${r.instId}">
    <td>${idx+1}</td><td><b>${r.instId}</b><br><span class="muted">${r.name}</span></td>
    <td><span class="tag ${tagClass}">${r.label}</span></td><td>${fmtUSD(r.price)}</td>
    <td>${p?`${fmtPrice(p.entryLow)} - ${fmtPrice(p.entryHigh)}`:'—'}</td><td>${p?fmtUSD(p.stop):'—'}</td><td>${p?fmtUSD(p.tp2):'—'}</td>
    <td>${p?`1:${p.rr.toFixed(1)}`:'—'}</td><td>${action}</td><td>${escapeHtml(firstReason)}</td>
  </tr>`;
}
function escapeHtml(str){ return String(str).replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function updateSymbolOptions(){
  const oldBase = baseCoin($('symbolSelect').value || 'BTC-USDT-SWAP');
  const symbols = currentSymbols();
  $('symbolSelect').innerHTML = symbols.map(([id,name])=>`<option value="${id}">${id}｜${name}</option>`).join('');
  const match = symbols.find(([id])=>baseCoin(id)===oldBase);
  if(match) $('symbolSelect').value = match[0];
  const isSpot = $('marketSelect').value === 'spot';
  $('leverageSelect').disabled = isSpot;
  $('leverageSelect').title = isSpot ? '現貨沒有槓桿' : '';
}
function init(){
  updateSymbolOptions();
  $('marketSelect').addEventListener('change',()=>{ updateSymbolOptions(); if(lastAnalysis) analyzeSelected(); });
  $('symbolSelect').addEventListener('change',()=>{ if(lastAnalysis) analyzeSelected(); });
  $('analyzeBtn').addEventListener('click', analyzeSelected);
  $('refreshBtn').addEventListener('click', analyzeSelected);
  $('scanBtn').addEventListener('click', scanSymbols);
  if($('rescanTopBtn')) $('rescanTopBtn').addEventListener('click', ()=>scanTopPicks(false));
  if($('copyTicketBtn')) $('copyTicketBtn').addEventListener('click', async ()=>{
    const text = $('copyTicketBtn').dataset.copy || '尚未產生下單參數';
    try{
      await navigator.clipboard.writeText(text);
      $('copyTicketBtn').textContent = '已複製';
      setTimeout(()=>$('copyTicketBtn').textContent='複製參數', 1200);
    }catch{
      alert(text);
    }
  });
  if($('copySimBtn')) $('copySimBtn').addEventListener('click', async ()=>{
    const text = $('copySimBtn').dataset.copy || '尚未產生策略模擬結果';
    try{
      await navigator.clipboard.writeText(text);
      $('copySimBtn').textContent = '已複製';
      setTimeout(()=>$('copySimBtn').textContent='複製模擬結果', 1200);
    }catch{
      alert(text);
    }
  });
  ['accountInput','riskSelect','leverageSelect','rrSelect','modeSelect','barSelect'].forEach(id=>$(id).addEventListener('change',()=>{ if(lastAnalysis) analyzeSelected(); }));
  setupOkxQuickActions(null);
  setStatus('準備完成。合約建議用逐倉、4H、1% 風險、2x 槓桿；現貨沒有做空，偏空就不買。');
  setTimeout(()=>scanTopPicks(true).catch(console.error), 500);
}
init();
