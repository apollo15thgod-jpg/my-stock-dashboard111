import React, { useState, useEffect, useCallback, useMemo } from 'react';

function App() {
  const API_KEY = 'd7j25k9r01qp3g1rhb10d7j25k9r01qp3g1rhb1g';
  const PRICE_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?output=csv";
  const HISTORY_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?gid=648456386&single=true&output=csv"; 
  const CALC_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?gid=606181682&single=true&output=csv"; 

  // --- 狀態管理 ---
  const [assets, setAssets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('myAssets')) || []; } catch(e) { return []; }
  });
  const [otherAssets, setOtherAssets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('myOtherAssets')) || []; } catch(e) { return []; }
  });
  const [liabilities, setLiabilities] = useState(() => {
    try { return JSON.parse(localStorage.getItem('myLiabilities')) || []; } catch(e) { return []; }
  });
  
  const [history, setHistory] = useState([]);
  const [exchangeRate, setExchangeRate] = useState(32.0);
  const [loading, setLoading] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showUS, setShowUS] = useState(true);
  const [showTW, setShowTW] = useState(true);
  const [showOther, setShowOther] = useState(true);
  const [showDebt, setShowDebt] = useState(true);
  const [todayMode, setTodayMode] = useState('val'); 
  const [priceMode, setPriceMode] = useState('unit');

  // --- 抓取匯率 ---
  const fetchRateFromCloud = useCallback(async () => {
    try {
      const res = await fetch(`${CALC_CSV_URL}&t=${Date.now()}`);
      const text = await res.text();
      const matches = text.match(/\d{2}\.\d+/g) || [];
      const validRates = matches.map(Number).filter(n => n >= 28 && n <= 35);
      if (validRates.length > 0) setExchangeRate(validRates[0]);
    } catch (e) { console.error("匯率抓取失敗", e); }
  }, [CALC_CSV_URL]);

  // --- 抓取歷史趨勢 ---
  const fetchHistoryFromCloud = useCallback(async () => {
    try {
      const res = await fetch(`${HISTORY_CSV_URL}&t=${Date.now()}`);
      const text = await res.text();
      const rows = text.split('\n').slice(1); 
      const cloudHistory = rows.map(row => {
        const cols = row.split(',');
        if (cols.length < 2) return null;
        return { ts: new Date(cols[0]).getTime(), val: parseFloat(cols[1].replace(/[^0-9.]/g, '')) };
      }).filter(item => item && !isNaN(item.val));
      setHistory(cloudHistory.sort((a,b) => a.ts - b.ts));
    } catch (e) { console.error("歷史數據抓取失敗", e); }
  }, [HISTORY_CSV_URL]);

  // --- 核心：刷新價格 (現價 A1, 昨日收盤 A2) ---
  const refreshPrices = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await fetchRateFromCloud();
      const csvRes = await fetch(`${PRICE_CSV_URL}&t=${Date.now()}`);
      const csvText = await csvRes.text();
      
      // 解析 CSV 矩陣並清洗空白字元
      const rows = csvText.split(/\r?\n/).map(row => row.split(',').map(cell => cell.trim()));
      
      // 依據你的設定：A1 (rows[0][0]) 是今日現價, A2 (rows[1][0]) 是昨日收盤
      const twCurrentPrice = parseFloat(rows[0]?.[0]) || 0;
      const twYesterdayClose = parseFloat(rows[1]?.[0]) || twCurrentPrice;

      const updated = await Promise.all(assets.map(async (item) => {
        if (!item.symbol) return item;
        try {
          if (!/^\d/.test(item.symbol)) {
            // 美股邏輯 (使用 Finnhub)
            const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${item.symbol}&token=${API_KEY}`);
            const data = await res.json();
            if (data.c) return { ...item, price: data.c, prevClose: data.pc || data.c };
          } else {
            // 台股邏輯：使用 Google Sheet 報價
            return { ...item, price: twCurrentPrice, prevClose: twYesterdayClose };
          }
        } catch (e) { console.error(`更新 ${item.symbol} 報價失敗`, e); }
        return item;
      }));
      setAssets(updated);
      await fetchHistoryFromCloud();
    } catch (e) { console.error("價格更新流程失敗", e); } finally { setLoading(false); }
  }, [assets, loading, fetchRateFromCloud, fetchHistoryFromCloud, PRICE_CSV_URL, API_KEY]);

  // --- 自動與手動副作用 ---
  useEffect(() => {
    refreshPrices();
    const autoTimer = setInterval(() => refreshPrices(), 60000); // 每一分鐘更新一次
    return () => clearInterval(autoTimer);
  }, []);

  useEffect(() => { localStorage.setItem('myAssets', JSON.stringify(assets)); }, [assets]);
  useEffect(() => { localStorage.setItem('myOtherAssets', JSON.stringify(otherAssets)); }, [otherAssets]);
  useEffect(() => { localStorage.setItem('myLiabilities', JSON.stringify(liabilities)); }, [liabilities]);

  // --- 計算核心 ---
  const calculateAsset = (item) => {
    const isUS = !/^\d/.test(item.symbol);
    const m = isUS ? exchangeRate : 1;
    const price = item.price || 0;
    const prevClose = item.prevClose || price; // 若無昨日報價則今日損益為 0
    
    const mv = price * (item.shares || 0) * m;
    const prevMv = prevClose * (item.shares || 0) * m;
    const costTWD = (item.totalCost || 0) * (isUS ? exchangeRate : 1); 

    const todayLoss = mv - prevMv;
    const todayPct = prevMv > 0 ? (todayLoss / prevMv) * 100 : 0;
    const totalLoss = mv - costTWD;
    const totalPct = costTWD > 0 ? (totalLoss / costTWD) * 100 : 0;

    return { isUS, mv, today: todayLoss, todayPct, total: totalLoss, totalPct, unitPrice: price };
  };

  // 分組與總結
  const usAssets = assets.filter(a => !/^\d/.test(a.symbol));
  const twAssets = assets.filter(a => /^\d/.test(a.symbol));
  const totalOtherAssets = otherAssets.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  const totalDebt = liabilities.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);

  const getGroupSum = (list) => list.reduce((acc, a) => {
    const d = calculateAsset(a);
    const m = d.isUS ? exchangeRate : 1;
    return { mv: acc.mv + d.mv, today: acc.today + d.today, total: acc.total + d.total, cost: acc.cost + (a.totalCost * m) };
  }, { mv: 0, today: 0, total: 0, cost: 0 });

  const usTotal = getGroupSum(usAssets);
  const twTotal = getGroupSum(twAssets);

  const grandTotal = { 
    mv: usTotal.mv + twTotal.mv + totalOtherAssets,
    today: usTotal.today + twTotal.today, 
    total: usTotal.total + twTotal.total,
    percent: (usTotal.cost + twTotal.cost) > 0 ? ((usTotal.total + twTotal.total) / (usTotal.cost + twTotal.cost)) * 100 : 0
  };

  const chartData = useMemo(() => {
    if (!history || history.length < 2) return null;
    const combinedHistory = history.map(h => ({ ...h, totalVal: h.val + totalOtherAssets }));
    const vals = combinedHistory.map(d => d.totalVal);
    const minV = Math.floor(Math.min(...vals) / 10000) * 10000;
    const maxV = Math.ceil(Math.max(...vals) / 10000) * 10000;
    const vRange = maxV - minV || 10000;
    const points = combinedHistory.map((h, i) => {
      const x = (i / (combinedHistory.length - 1)) * 100;
      const y = 100 - ((h.totalVal - minV) / vRange) * 100;
      return `${x},${y}`;
    }).join(' ');
    const yTicks = [];
    for (let v = minV; v <= maxV; v += 10000) yTicks.push(v);
    return { points, yTicks, minV, maxV, vRange };
  }, [history, totalOtherAssets]);

  const getValueColor = (val) => (val >= 0.01 ? '#ef4444' : val <= -0.01 ? '#22c55e' : '#64748b');

  return (
    <div style={{ padding: '12px', fontFamily: '-apple-system, sans-serif', maxWidth: '1000px', margin: '0 auto', minHeight: '100vh', background: '#f0f2f5' }}>
      
      {/* 操作欄 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '12px' }}>
        <button onClick={refreshPrices} disabled={loading} style={{ flex: 1, maxWidth: '120px', padding: '12px 0', background: '#fff', border: '1px solid #ddd', borderRadius: '12px', fontWeight: 'bold' }}>
          {loading ? '⚡ 更新中' : '🔄 更新報價'}
        </button>
        <button onClick={() => setShowAdmin(true)} style={{ flex: 1, maxWidth: '120px', padding: '12px 0', background: '#1e293b', color: '#fff', border: 'none', borderRadius: '12px', fontWeight: 'bold' }}>⚙️ 設定</button>
      </div>

      {/* 總資產面板 */}
      <div style={{ background: '#1e293b', color: '#fff', padding: '25px', borderRadius: '24px', marginBottom: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <div>
          <div style={{ fontSize: '12px', opacity: 0.6 }}>總資產 (TWD)</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{Math.round(grandTotal.mv).toLocaleString()}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '12px', opacity: 0.6 }}>美元匯率</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#fbbf24' }}>{exchangeRate.toFixed(2)}</div>
        </div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '15px' }}>
          <div style={{ fontSize: '12px', opacity: 0.6 }}>今日股票漲跌</div>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: getValueColor(grandTotal.today) }}>
            {grandTotal.today >= 0 ? '+' : ''}{Math.round(grandTotal.today).toLocaleString()}
          </div>
        </div>
        <div style={{ textAlign: 'right', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '15px' }}>
          <div style={{ fontSize: '12px', opacity: 0.6 }}>累計股票損益</div>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: getValueColor(grandTotal.total) }}>
            {Math.round(grandTotal.total).toLocaleString()} ({grandTotal.percent.toFixed(1)}%)
          </div>
        </div>
      </div>

      {/* 趨勢圖 */}
      <div style={{ background: '#fff', padding: '20px', borderRadius: '24px', marginBottom: '20px' }}>
        <b style={{ display:'block', marginBottom:'16px', fontSize: '14px' }}>📊 資產趨勢 (含存款)</b>
        <div style={{ height: '150px', width: '100%', position: 'relative', paddingLeft: '40px' }}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
            {chartData?.yTicks.map(tick => {
              const y = 100 - ((tick - chartData.minV) / chartData.vRange) * 100;
              return (
                <g key={tick}>
                  <line x1="0" y1={y} x2="100" y2={y} stroke="#eee" strokeWidth="0.5" />
                  <text x="-5" y={y} fontSize="4" fill="#999" textAnchor="end" dominantBaseline="middle">{tick / 10000}萬</text>
                </g>
              );
            })}
            {chartData && <polyline points={chartData.points} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
          </svg>
        </div>
      </div>

      {/* 股票資產列表 */}
      <MobileSection title="🇺🇸 美股資產" total={usTotal} show={showUS} setShow={setShowUS} color="#3b82f6">
        <AssetTable list={usAssets} calc={calculateAsset} getValColor={getValueColor} todayMode={todayMode} setTodayMode={setTodayMode} priceMode={priceMode} setPriceMode={setPriceMode} />
      </MobileSection>

      <MobileSection title="🇹🇼 台股資產" total={twTotal} show={showTW} setShow={setShowTW} color="#ef4444">
        <AssetTable list={twAssets} calc={calculateAsset} getValColor={getValueColor} todayMode={todayMode} setTodayMode={setTodayMode} priceMode={priceMode} setPriceMode={setPriceMode} />
      </MobileSection>

      {/* 存款與負債 */}
      <SimpleList title="🏦 銀行存款/現金" total={totalOtherAssets} items={otherAssets} show={showOther} setShow={setShowOther} color="#3b82f6" />
      <SimpleList title="💸 負債明細" total={totalDebt} items={liabilities} show={showDebt} setShow={setShowDebt} color="#64748b" isDebt />

      {/* 設定彈窗 */}
      {showAdmin && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 2000, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ background: '#fff', width: '100%', padding: '24px', borderTopLeftRadius: '24px', borderTopRightRadius: '24px', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}><h3>資產配置設定</h3><button onClick={() => setShowAdmin(false)} style={{ fontSize: '20px', border: 'none', background: 'none' }}>✕</button></div>
            
            <p style={{ fontWeight: 'bold', color: '#3b82f6' }}>📈 股票 (代號/股數/總成本TWD)</p>
            {assets.map(item => (
              <div key={item.id} style={{ display: 'flex', gap: '5px', marginBottom: '8px' }}>
                <input style={{ flex: 1, padding: '10px', border: '1px solid #ddd', borderRadius: '8px' }} value={item.symbol} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, symbol: e.target.value.toUpperCase()} : a))} placeholder="代號" />
                <input style={{ flex: 1, padding: '10px', border: '1px solid #ddd', borderRadius: '8px' }} type="number" value={item.shares} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, shares: parseFloat(e.target.value)} : a))} placeholder="股數" />
                <input style={{ flex: 1, padding: '10px', border: '1px solid #ddd', borderRadius: '8px' }} type="number" value={item.totalCost} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, totalCost: parseFloat(e.target.value)} : a))} placeholder="成本" />
                <button onClick={() => setAssets(assets.filter(a => a.id !== item.id))} style={{ color: '#ef4444', border: 'none', background: 'none' }}>✕</button>
              </div>
            ))}
            <button onClick={() => setAssets([...assets, { id: Date.now(), symbol: '', shares: 0, totalCost: 0 }])} style={{ width: '100%', padding: '10px', marginBottom: '20px', borderRadius: '8px', border: '1px dashed #ccc' }}>+ 新增股票</button>

            <p style={{ fontWeight: 'bold', color: '#10b981' }}>🏦 存款名稱 / 金額</p>
            {otherAssets.map(item => (
              <div key={item.id} style={{ display: 'flex', gap: '5px', marginBottom: '8px' }}>
                <input style={{ flex: 2, padding: '10px', border: '1px solid #ddd', borderRadius: '8px' }} value={item.name} onChange={e => setOtherAssets(otherAssets.map(o => o.id === item.id ? {...o, name: e.target.value} : o))} />
                <input style={{ flex: 1, padding: '10px', border: '1px solid #ddd', borderRadius: '8px' }} type="number" value={item.amount} onChange={e => setOtherAssets(otherAssets.map(o => o.id === item.id ? {...o, amount: parseFloat(e.target.value)} : o))} />
                <button onClick={() => setOtherAssets(otherAssets.filter(o => o.id !== item.id))} style={{ color: '#ef4444', border: 'none', background: 'none' }}>✕</button>
              </div>
            ))}
            <button onClick={() => setOtherAssets([...otherAssets, { id: Date.now(), name: '', amount: 0 }])} style={{ width: '100%', padding: '10px', marginBottom: '20px', borderRadius: '8px', border: '1px dashed #ccc' }}>+ 新增存款</button>

            <button onClick={() => {setShowAdmin(false); refreshPrices();}} style={{ width: '100%', padding: '15px', background: '#1e293b', color: '#fff', borderRadius: '12px', fontWeight: 'bold', fontSize: '16px' }}>儲存並關閉</button>
          </div>
        </div>
      )}
    </div>
  );
}

// 輔助組件：列表容器
function MobileSection({ title, total, show, setShow, color, children }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div onClick={() => setShow(!show)} style={{ background: '#fff', padding: '16px 20px', borderRadius: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderLeft: `6px solid ${color}` }}>
        <b style={{ fontSize: '15px' }}>{title} {show ? '▲' : '▼'}</b>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 'bold' }}>{Math.round(total.mv).toLocaleString()}</div>
          <div style={{ fontSize: '12px', color: total.today >= 0 ? '#ef4444' : '#22c55e', fontWeight: 'bold' }}>{total.today >= 0 ? '+' : ''}{Math.round(total.today).toLocaleString()}</div>
        </div>
      </div>
      {show && children}
    </div>
  );
}

// 輔助組件：資產表格
function AssetTable({ list, calc, getValColor, todayMode, setTodayMode, priceMode, setPriceMode }) {
  return (
    <div style={{ background: '#fff', marginTop: '4px', borderRadius: '16px', overflow: 'hidden', border: '1px solid #eee' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead style={{ background: '#f9fafb' }}>
          <tr style={{ textAlign: 'left', color: '#666' }}>
            <th style={{ padding: '12px' }}>標的</th>
            <th style={{ padding: '12px' }} onClick={() => setPriceMode(priceMode==='unit'?'total':'unit')}>價格▼</th>
            <th style={{ padding: '12px' }} onClick={() => setTodayMode(todayMode==='val'?'pct':'val')}>今日▼</th>
            <th style={{ padding: '12px' }}>累計</th>
          </tr>
        </thead>
        <tbody>
          {list.map(item => {
            const d = calc(item);
            return (
              <tr key={item.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                <td style={{ padding: '12px' }}><b>{item.symbol}</b><br/><small style={{color:'#999'}}>{item.shares.toLocaleString()}</small></td>
                <td style={{ padding: '12px' }}>{priceMode === 'unit' ? (d.isUS ? '$' : '') + d.unitPrice.toLocaleString() : Math.round(d.mv).toLocaleString()}</td>
                <td style={{ padding: '12px', color: getValColor(d.today) }}>{todayMode === 'val' ? (d.today >= 0 ? '+' : '') + Math.round(d.today).toLocaleString() : (d.todayPct >= 0 ? '+' : '') + d.todayPct.toFixed(2) + '%'}</td>
                <td style={{ padding: '12px', color: getValColor(d.total), fontWeight: 'bold' }}>{d.totalPct.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// 輔助組件：簡單列表 (存款/負債)
function SimpleList({ title, total, items, show, setShow, color, isDebt }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div onClick={() => setShow(!show)} style={{ background: '#fff', padding: '16px 20px', borderRadius: '20px', display: 'flex', justifyContent: 'space-between', borderLeft: `6px solid ${color}` }}>
        <b style={{ fontSize: '15px' }}>{title} {show ? '▲' : '▼'}</b>
        <b style={{ color: isDebt ? '#ef4444' : '#333' }}>{isDebt ? '-' : ''}{Math.round(total).toLocaleString()}</b>
      </div>
      {show && items.map(item => (
        <div key={item.id} style={{ background: '#fff', display: 'flex', justifyContent: 'space-between', padding: '12px 25px', borderTop: '1px solid #f0f0f0', fontSize: '14px' }}>
          <span>{item.name}</span>
          <span>{Math.round(item.amount).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export default App;
