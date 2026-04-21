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

  // --- 數據抓取 ---
  const fetchRateFromCloud = useCallback(async () => {
    try {
      const res = await fetch(`${CALC_CSV_URL}&t=${Date.now()}`);
      const text = await res.text();
      const matches = text.match(/\d{2}\.\d+/g) || [];
      const validRates = matches.map(Number).filter(n => n >= 28 && n <= 35);
      if (validRates.length > 0) setExchangeRate(validRates[0]);
    } catch (e) { console.error(e); }
  }, [CALC_CSV_URL]);

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
    } catch (e) { console.error(e); }
  }, [HISTORY_CSV_URL]);

  const refreshPrices = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await fetchRateFromCloud();
      const csvRes = await fetch(`${PRICE_CSV_URL}&t=${Date.now()}`);
      const csvText = await csvRes.text();
      
      // 解析台股備份價格 (假設 CSV 第二列：A2=代號, B2=現價, C2=昨收)
      const rows = csvText.split('\n').map(r => r.split(','));
      const backupPrice = parseFloat(rows[1]?.[1]) || 0;
      const backupPrevClose = parseFloat(rows[1]?.[2]) || backupPrice;

      const updated = await Promise.all(assets.map(async (item) => {
        if (!item.symbol) return item;
        try {
          if (!/^\d/.test(item.symbol)) {
            // 美股 API
            const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${item.symbol}&token=${API_KEY}`);
            const data = await res.json();
            if (data.c) return { ...item, price: data.c, prevClose: data.pc || data.c };
          } else {
            // 台股使用 CSV 資料
            return { ...item, price: backupPrice, prevClose: backupPrevClose };
          }
        } catch (e) { console.error(e); }
        return item;
      }));
      setAssets(updated);
      await fetchHistoryFromCloud();
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [assets, loading, fetchRateFromCloud, fetchHistoryFromCloud, PRICE_CSV_URL, API_KEY]);

  useEffect(() => {
    const autoTimer = setInterval(() => refreshPrices(), 30000); // 每30秒更新一次
    return () => clearInterval(autoTimer);
  }, [refreshPrices]);

  useEffect(() => { fetchHistoryFromCloud(); fetchRateFromCloud(); }, [fetchHistoryFromCloud, fetchRateFromCloud]);
  
  useEffect(() => { localStorage.setItem('myAssets', JSON.stringify(assets)); }, [assets]);
  useEffect(() => { localStorage.setItem('myOtherAssets', JSON.stringify(otherAssets)); }, [otherAssets]);
  useEffect(() => { localStorage.setItem('myLiabilities', JSON.stringify(liabilities)); }, [liabilities]);

  // --- 計算核心 ---
  const calculateAsset = (item) => {
    const isUS = !/^\d/.test(item.symbol);
    const m = isUS ? exchangeRate : 1;
    const price = item.price || 0;
    const prevClose = item.prevClose || price;
    const mv = price * (item.shares || 0) * m;
    const prevMv = prevClose * (item.shares || 0) * m;
    const costTWD = (item.totalCost || 0) * (isUS ? exchangeRate : 1); 
    
    const todayLoss = mv - prevMv;
    const todayPct = prevMv > 0 ? (todayLoss / prevMv) * 100 : 0;
    const totalLoss = mv - costTWD;
    const totalPct = costTWD > 0 ? (totalLoss / costTWD) * 100 : 0;
    
    return { isUS, mv, today: todayLoss, todayPct, total: totalLoss, totalPct, unitPrice: price };
  };

  const usAssets = assets.filter(a => !/^\d/.test(a.symbol));
  const twAssets = assets.filter(a => /^\d/.test(a.symbol));
  const totalOtherAssets = otherAssets.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  const totalDebt = liabilities.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);

  const getSum = (list) => list.reduce((acc, a) => {
    const d = calculateAsset(a);
    const isUS = !/^\d/.test(a.symbol);
    return { 
      mv: acc.mv + d.mv, 
      today: acc.today + d.today, 
      total: acc.total + d.total, 
      cost: acc.cost + (a.totalCost * (isUS ? exchangeRate : 1)) 
    };
  }, { mv: 0, today: 0, total: 0, cost: 0 });

  const usTotal = getSum(usAssets);
  const twTotal = getSum(twAssets);

  const grandTotal = { 
    mv: usTotal.mv + twTotal.mv + totalOtherAssets,
    today: usTotal.today + twTotal.today, 
    total: usTotal.total + twTotal.total,
    percent: (usTotal.cost + twTotal.cost) > 0 ? ((usTotal.total + twTotal.total) / (usTotal.cost + twTotal.cost)) * 100 : 0
  };

  // --- 圖表邏輯：加總 台股 + 美股 + 存款 ---
  const chartData = useMemo(() => {
    if (!history || history.length < 2) return null;
    const combinedHistory = history.map(h => ({ ...h, totalVal: h.val + totalOtherAssets }));
    const vals = combinedHistory.map(d => d.totalVal);
    const minV = Math.floor(Math.min(...vals) / 10000) * 10000;
    const maxV = Math.ceil(Math.max(...vals) / 10000) * 10000;
    const vRange = maxV - minV || 10000;
    const yTicks = [];
    for (let v = minV; v <= maxV; v += 10000) yTicks.push(v);
    const points = combinedHistory.map((h, i) => {
      const x = (i / (combinedHistory.length - 1)) * 100;
      const y = 100 - ((h.totalVal - minV) / vRange) * 100;
      return `${x},${y}`;
    }).join(' ');
    return { points, yTicks, minV, maxV, vRange };
  }, [history, totalOtherAssets]);

  const getValueColor = (val) => (val >= 0 ? '#ef4444' : '#22c55e');

  return (
    <div style={{ padding: '12px', fontFamily: '-apple-system, system-ui, sans-serif', maxWidth: '1000px', margin: '0 auto', minHeight: '100vh', background: '#f8fafc', boxSizing: 'border-box' }}>
      
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '12px' }}>
        <button onClick={refreshPrices} disabled={loading} style={{ flex: 1, maxWidth: '120px', padding: '12px 0', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold' }}>
          {loading ? '⚡ 更新中' : '🔄 刷新價格'}
        </button>
        <button onClick={() => setShowAdmin(!showAdmin)} style={{ flex: 1, maxWidth: '120px', padding: '12px 0', background: '#1e293b', color: '#fff', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold' }}>⚙️ 設定</button>
      </div>

      <div style={{ background: '#1e293b', color: '#fff', padding: '25px', borderRadius: '24px', marginBottom: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <div>
          <div style={{ fontSize: '12px', opacity: 0.6 }}>總資產 (含存款)</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{Math.round(grandTotal.mv).toLocaleString()}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '12px', opacity: 0.6 }}>即時匯率</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#fbbf24' }}>{exchangeRate.toFixed(2)}</div>
        </div>
        <div>
          <div style={{ fontSize: '12px', opacity: 0.6 }}>今日損益</div>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: getValueColor(grandTotal.today) }}>{grandTotal.today >= 0 ? '+' : ''}{Math.round(grandTotal.today).toLocaleString()}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '12px', opacity: 0.6 }}>累積損益</div>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: getValueColor(grandTotal.total) }}>{grandTotal.percent.toFixed(2)}%</div>
        </div>
      </div>

      {/* 歷史趨勢圖 */}
      <div style={{ background: '#fff', padding: '20px', borderRadius: '24px', marginBottom: '20px', border: '1px solid #e2e8f0' }}>
        <b style={{ fontSize: '16px', display:'block', marginBottom:'16px' }}>📊 總資產歷史趨勢</b>
        <div style={{ height: '180px', width: '100%', position: 'relative', paddingLeft: '40px' }}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
            {chartData?.yTicks.map(tick => {
              const y = 100 - ((tick - chartData.minV) / chartData.vRange) * 100;
              return (
                <g key={tick}>
                  <line x1="0" y1={y} x2="100" y2={y} stroke="#f1f5f9" strokeWidth="0.5" />
                  <text x="-4" y={y} fontSize="4" fill="#94a3b8" textAnchor="end" dominantBaseline="middle">{tick / 10000}萬</text>
                </g>
              );
            })}
            {chartData && <polyline points={chartData.points} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
          </svg>
        </div>
      </div>

      <MobileSection title="🇺🇸 美股資產" total={usTotal} show={showUS} setShow={setShowUS}>
        <AssetTable list={usAssets} calc={calculateAsset} getValColor={getValueColor} todayMode={todayMode} setTodayMode={setTodayMode} priceMode={priceMode} setPriceMode={setPriceMode} />
      </MobileSection>

      <MobileSection title="🇹🇼 台股資產" total={twTotal} show={showTW} setShow={setShowTW}>
        <AssetTable list={twAssets} calc={calculateAsset} getValColor={getValueColor} todayMode={todayMode} setTodayMode={setTodayMode} priceMode={priceMode} setPriceMode={setPriceMode} />
      </MobileSection>

      <div style={{ marginBottom: '12px' }}>
        <div onClick={() => setShowOther(!showOther)} style={{ background: '#fff', padding: '18px 20px', borderRadius: '20px', display: 'flex', justifyContent: 'space-between', alignItems:'center', borderLeft: '6px solid #3b82f6' }}>
          <b style={{ fontSize: '16px' }}>🏦 銀行存款 {showOther ? '▲' : '▼'}</b>
          <span style={{ fontWeight: 'bold' }}>{Math.round(totalOtherAssets).toLocaleString()}</span>
        </div>
        {showOther && (
          <div style={{ background: 'rgba(255,255,255,0.7)', marginTop: '6px', borderRadius: '16px', overflow: 'hidden' }}>
            {otherAssets.map(item => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '15px 20px', borderBottom: '1px solid #f1f5f9' }}>
                <span>{item.name}</span>
                <span style={{ fontWeight: 'bold' }}>{Math.round(item.amount).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginBottom: '40px' }}>
        <div onClick={() => setShowDebt(!showDebt)} style={{ background: '#fff', padding: '18px 20px', borderRadius: '20px', display: 'flex', justifyContent: 'space-between', alignItems:'center', borderLeft: '6px solid #94a3b8' }}>
          <b style={{ fontSize: '16px' }}>💸 負債明細 {showDebt ? '▲' : '▼'}</b>
          <span style={{ color: '#ef4444', fontWeight: 'bold' }}>-{Math.round(totalDebt).toLocaleString()}</span>
        </div>
        {showDebt && (
          <div style={{ background: 'rgba(255,255,255,0.7)', marginTop: '6px', borderRadius: '16px', overflow: 'hidden' }}>
            {liabilities.map(item => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '15px 20px', borderBottom: '1px solid #f1f5f9' }}>
                <span>{item.name}</span>
                <span style={{ color: '#ef4444', fontWeight: 'bold' }}>-{Math.round(item.amount).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAdmin && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', zIndex: 1000 }}>
          <div style={{ background: '#fff', padding: '24px', borderTopLeftRadius: '24px', borderTopRightRadius: '24px', width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}><h3>資產設定</h3><button onClick={() => setShowAdmin(false)}>關閉</button></div>
            
            <p style={{ fontWeight: 'bold', color: '#3b82f6' }}>股票 (代號/股數/總成本TWD)</p>
            {assets.map(item => (
              <div key={item.id} style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
                <input style={{ flex: 1, padding: '8px' }} value={item.symbol} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, symbol: e.target.value.toUpperCase()} : a))} placeholder="代號" />
                <input style={{ flex: 1, padding: '8px' }} type="number" value={item.shares} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, shares: parseFloat(e.target.value)} : a))} placeholder="股數" />
                <input style={{ flex: 1, padding: '8px' }} type="number" value={item.totalCost} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, totalCost: parseFloat(e.target.value)} : a))} placeholder="總成本" />
                <button onClick={() => setAssets(assets.filter(a => a.id !== item.id))}>✕</button>
              </div>
            ))}
            <button onClick={() => setAssets([...assets, { id: Date.now(), symbol: '', shares: 0, totalCost: 0 }])} style={{ width: '100%', padding: '10px', marginBottom: '15px' }}>+ 新增股票</button>

            <p style={{ fontWeight: 'bold', color: '#10b981' }}>銀行存款 (名稱/金額)</p>
            {otherAssets.map(item => (
              <div key={item.id} style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
                <input style={{ flex: 2, padding: '8px' }} value={item.name} onChange={e => setOtherAssets(otherAssets.map(o => o.id === item.id ? {...o, name: e.target.value} : o))} />
                <input style={{ flex: 1, padding: '8px' }} type="number" value={item.amount} onChange={e => setOtherAssets(otherAssets.map(o => o.id === item.id ? {...o, amount: parseFloat(e.target.value)} : o))} />
                <button onClick={() => setOtherAssets(otherAssets.filter(o => o.id !== item.id))}>✕</button>
              </div>
            ))}
            <button onClick={() => setOtherAssets([...otherAssets, { id: Date.now(), name: '', amount: 0 }])} style={{ width: '100%', padding: '10px', marginBottom: '15px' }}>+ 新增存款</button>

            <p style={{ fontWeight: 'bold', color: '#ef4444' }}>負債 (名稱/金額)</p>
            {liabilities.map(item => (
              <div key={item.id} style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
                <input style={{ flex: 2, padding: '8px' }} value={item.name} onChange={e => setLiabilities(liabilities.map(l => l.id === item.id ? {...l, name: e.target.value} : l))} />
                <input style={{ flex: 1, padding: '8px' }} type="number" value={item.amount} onChange={e => setLiabilities(liabilities.map(l => l.id === item.id ? {...l, amount: parseFloat(e.target.value)} : l))} />
                <button onClick={() => setLiabilities(liabilities.filter(l => l.id !== item.id))}>✕</button>
              </div>
            ))}
            <button onClick={() => setLiabilities([...liabilities, { id: Date.now(), name: '', amount: 0 }])} style={{ width: '100%', padding: '10px', marginBottom: '20px' }}>+ 新增負債</button>

            <button onClick={() => setShowAdmin(false)} style={{ width: '100%', padding: '15px', background: '#1e293b', color: '#fff', borderRadius: '12px' }}>儲存並關閉</button>
          </div>
        </div>
      )}
    </div>
  );
}

function MobileSection({ title, total, show, setShow, children }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div onClick={() => setShow(!show)} style={{ background: '#fff', padding: '16px 20px', borderRadius: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #e2e8f0' }}>
        <b style={{ fontSize: '16px' }}>{title} {show ? '▲' : '▼'}</b>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '15px', fontWeight: 'bold' }}>{Math.round(total.mv).toLocaleString()}</div>
          <div style={{ fontSize: '12px', color: total.today >= 0 ? '#ef4444' : '#22c55e', fontWeight: 'bold' }}>{total.today >= 0 ? '+' : ''}{Math.round(total.today).toLocaleString()}</div>
        </div>
      </div>
      {show && children}
    </div>
  );
}

function AssetTable({ list, calc, getValColor, todayMode, setTodayMode, priceMode, setPriceMode }) {
  return (
    <div style={{ overflowX: 'auto', background: '#fff', marginTop: '6px', borderRadius: '18px', border: '1px solid #e2e8f0' }}>
      <table style={{ width: '100%', minWidth: '380px', borderCollapse: 'collapse', fontSize: '14px' }}>
        <thead style={{ background: '#f8fafc' }}>
          <tr style={{ textAlign: 'left', color: '#64748b' }}>
            <th style={{ padding: '12px 15px' }}>代號</th>
            <th style={{ padding: '12px 15px', cursor: 'pointer' }} onClick={() => setPriceMode(priceMode === 'total' ? 'unit' : 'total')}>{priceMode === 'unit' ? '現價' : '現值'}</th>
            <th style={{ padding: '12px 15px', cursor: 'pointer' }} onClick={() => setTodayMode(todayMode === 'val' ? 'pct' : 'val')}>今日</th>
            <th style={{ padding: '12px 15px' }}>累積</th>
          </tr>
        </thead>
        <tbody>
          {list.map(item => {
            const d = calc(item);
            return (
              <tr key={item.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ padding: '12px 15px' }}><b>{item.symbol}</b><br/><small>{item.shares.toLocaleString()}</small></td>
                <td style={{ padding: '12px 15px' }}>{priceMode === 'unit' ? (d.isUS ? '$' : '') + d.unitPrice.toLocaleString() : Math.round(d.mv).toLocaleString()}</td>
                <td style={{ padding: '12px 15px', color: getValColor(d.today), fontWeight: 'bold' }}>{todayMode === 'val' ? (d.today >= 0 ? '+' : '') + Math.round(d.today).toLocaleString() : (d.todayPct >= 0 ? '+' : '') + d.todayPct.toFixed(2) + '%'}</td>
                <td style={{ padding: '12px 15px' }}><div style={{ color: getValColor(d.total), fontWeight: 'bold' }}>{d.totalPct.toFixed(1)}%</div></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default App;
