const SYMBOLS = [
  ['BTC-USDT-SWAP','Bitcoin'], ['ETH-USDT-SWAP','Ethereum'], ['SOL-USDT-SWAP','Solana'],
  ['XRP-USDT-SWAP','XRP'], ['DOGE-USDT-SWAP','Dogecoin'], ['ADA-USDT-SWAP','Cardano'],
  ['AVAX-USDT-SWAP','Avalanche'], ['LINK-USDT-SWAP','Chainlink'], ['DOT-USDT-SWAP','Polkadot'],
  ['LTC-USDT-SWAP','Litecoin'], ['BCH-USDT-SWAP','Bitcoin Cash'], ['TRX-USDT-SWAP','TRON'],
  ['NEAR-USDT-SWAP','NEAR'], ['APT-USDT-SWAP','Aptos'], ['OP-USDT-SWAP','Optimism'],
  ['ARB-USDT-SWAP','Arbitrum'], ['FIL-USDT-SWAP','Filecoin'], ['ETC-USDT-SWAP','Ethereum Classic'],
  ['SUI-USDT-SWAP','Sui'], ['TON-USDT-SWAP','Toncoin']
];

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

function makePlan(side, price, atrV, lev, account, riskPct, minRR, lvls){
  if(side==='LONG'){
    const entryMid = price;
    const entryLow = price - atrV*0.25;
    const entryHigh = price + atrV*0.10;
    const structureStop = lvls.recentLow - atrV*0.2;
    const atrStop = entryMid - atrV*1.25;
    const stop = Math.min(structureStop, atrStop);
    const risk = Math.max(entryMid-stop, atrV*0.8);
    return finalizePlan(side, entryLow, entryHigh, entryMid, stop, risk, lev, account, riskPct, minRR);
  }
  if(side==='SHORT'){
    const entryMid = price;
    const entryLow = price - atrV*0.10;
    const entryHigh = price + atrV*0.25;
    const structureStop = lvls.recentHigh + atrV*0.2;
    const atrStop = entryMid + atrV*1.25;
    const stop = Math.max(structureStop, atrStop);
    const risk = Math.max(stop-entryMid, atrV*0.8);
    return finalizePlan(side, entryLow, entryHigh, entryMid, stop, risk, lev, account, riskPct, minRR);
  }
  return null;
}
function finalizePlan(side, entryLow, entryHigh, entryMid, stop, risk, lev, account, riskPct, minRR){
  const dir = side==='LONG' ? 1 : -1;
  const tp1 = entryMid + dir*risk;
  const tp2 = entryMid + dir*risk*2;
  const tp3 = entryMid + dir*risk*3;
  const riskCash = account*riskPct;
  const qtyCoin = risk > 0 ? riskCash / risk : 0;
  const notional = qtyCoin * entryMid;
  const margin = lev > 0 ? notional / lev : notional;
  return {side, entryLow, entryHigh, entryMid, stop, tp1, tp2, tp3, risk, rr: 2, qtyCoin, notional, margin, minRR};
}

function analyzeFromCandles(instId, candles, ticker={}){
  const account = Number($('accountInput').value || 1000);
  const riskPct = Number($('riskSelect').value || .01);
  const lev = Number($('leverageSelect').value || 2);
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

  let plan = side==='WAIT' ? null : makePlan(side, price, atr14, lev, account, riskPct, minRR, lvls);
  if(plan){
    const rrOk = plan.rr >= minRR;
    if(!rrOk){ side='WAIT'; label='等待，不交易'; grade='wait'; warnings.push(`風險報酬比低於 ${minRR}，不符合新手交易條件。`); plan=null; }
  }

  const reasons = side==='LONG' ? reasonsLong : side==='SHORT' ? reasonsShort : warnings.slice(0,3);
  if(side==='WAIT' && reasons.length===0) reasons.push('目前沒有明確方向，先等待比較安全。');
  warnings.forEach(w=>{ if(!reasons.includes(w)) reasons.push(w); });

  return {instId, candles, ticker, price, sma20, sma50, rsi14, atr14, atrPct, distSma20, trend10, trend30, lvls, volR, long, short, side, label, grade, plan, reasons, s20, s50, account, riskPct, lev, minRR};
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

function setBusy(b){
  ['analyzeBtn','scanBtn','refreshBtn'].forEach(id=>$(id).disabled=b);
}

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
  renderReasons(a.reasons);
  renderMetrics(a);
  renderChart(a);
}
function simpleText(a){
  if(a.side==='LONG') return '目前偏多，可以等待價格落在進場區附近，再用止損控制風險。不要看到綠色就重倉追高。';
  if(a.side==='SHORT') return '目前偏空，可以觀察做空，但這是合約交易，新手一定要設好止損，避免反彈爆倉。';
  return '目前建議等待，不交易。方向不夠明確或風險條件不漂亮時，空手就是最安全的策略。';
}
function renderPlan(a){
  if(!a.plan){
    $('sideOut').textContent='等待';
    ['entryOut','stopOut','tp1Out','tp2Out','tp3Out','rrOut','positionOut','marginOut'].forEach(id=>$(id).textContent='—');
    return;
  }
  const p=a.plan;
  $('sideOut').textContent = p.side==='LONG' ? '做多 Long' : '做空 Short';
  $('entryOut').textContent = `${fmtPrice(p.entryLow)} - ${fmtPrice(p.entryHigh)}`;
  $('stopOut').textContent = fmtUSD(p.stop);
  $('tp1Out').textContent = fmtUSD(p.tp1);
  $('tp2Out').textContent = fmtUSD(p.tp2);
  $('tp3Out').textContent = fmtUSD(p.tp3);
  $('rrOut').textContent = `約 1 : ${p.rr.toFixed(1)}`;
  $('positionOut').textContent = `${fmtPrice(p.notional)} USDT 名義倉位`;
  $('marginOut').textContent = `${fmtPrice(p.margin)} USDT，${a.lev}x`;
}
function renderReasons(reasons){
  $('reasons').innerHTML = reasons.map(r=>`<li>${escapeHtml(r)}</li>`).join('');
}
function renderMetrics(a){
  const rows = [
    ['現價', fmtUSD(a.price)], ['24H 漲跌', fmtPct(a.ticker.change24h)],
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

async function scanSymbols(){
  setBusy(true);
  const bar = $('barSelect').value;
  const body = $('scanBody');
  body.innerHTML = '';
  setStatus('正在掃描 OKX 主流幣，請稍候...');
  const results=[];
  for(let i=0;i<SYMBOLS.length;i++){
    const [instId,name]=SYMBOLS[i];
    setStatus(`掃描中 ${i+1}/${SYMBOLS.length}：${instId}`);
    try{
      const [candles,ticker] = await Promise.all([getCandles(instId, bar, 200), getTicker(instId)]);
      const a = analyzeFromCandles(instId, candles, ticker);
      results.push({rank:i+1,name,...a});
      await sleep(80);
    }catch(err){
      results.push({rank:i+1, name, instId, error: err.message || String(err)});
    }
  }
  results.sort((a,b)=>{
    const scoreA = a.error ? -1 : Math.max(a.long||0, a.short||0) + (a.side==='WAIT' ? -25 : 0);
    const scoreB = b.error ? -1 : Math.max(b.long||0, b.short||0) + (b.side==='WAIT' ? -25 : 0);
    return scoreB-scoreA;
  });
  body.innerHTML = results.map((r,idx)=>renderScanRow(r,idx)).join('');
  [...body.querySelectorAll('tr[data-inst]')].forEach(tr=>{
    tr.addEventListener('click',()=>{ $('symbolSelect').value=tr.dataset.inst; analyzeSelected(); window.scrollTo({top:0,behavior:'smooth'}); });
  });
  setStatus('掃描完成。點擊任一列可以切換到該幣種詳細分析。');
  setBusy(false);
}
function renderScanRow(r,idx){
  if(r.error) return `<tr><td>${idx+1}</td><td>${r.instId}</td><td colspan="7" class="negative">資料失敗：${escapeHtml(r.error)}</td></tr>`;
  const tagClass = r.side==='LONG'?'long':r.side==='SHORT'?'short':'wait';
  const p=r.plan;
  const firstReason = r.reasons?.[0] || '—';
  return `<tr data-inst="${r.instId}">
    <td>${idx+1}</td><td><b>${r.instId}</b><br><span class="muted">${r.name}</span></td>
    <td><span class="tag ${tagClass}">${r.label}</span></td><td>${fmtUSD(r.price)}</td>
    <td>${p?`${fmtPrice(p.entryLow)} - ${fmtPrice(p.entryHigh)}`:'—'}</td><td>${p?fmtUSD(p.stop):'—'}</td><td>${p?fmtUSD(p.tp2):'—'}</td>
    <td>${p?`1:${p.rr.toFixed(1)}`:'—'}</td><td>${escapeHtml(firstReason)}</td>
  </tr>`;
}
function escapeHtml(str){ return String(str).replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function init(){
  $('symbolSelect').innerHTML = SYMBOLS.map(([id,name])=>`<option value="${id}">${id}｜${name}</option>`).join('');
  $('analyzeBtn').addEventListener('click', analyzeSelected);
  $('refreshBtn').addEventListener('click', analyzeSelected);
  $('scanBtn').addEventListener('click', scanSymbols);
  ['accountInput','riskSelect','leverageSelect','rrSelect','modeSelect'].forEach(id=>$(id).addEventListener('change',()=>{ if(lastAnalysis) analyzeSelected(); }));
  setStatus('準備完成。建議新手先用 4H、1% 風險、2x 槓桿。');
}
init();
