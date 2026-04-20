import React, { useState, useEffect, useCallback } from 'react';

function App() {
  const API_KEY = 'd7j25k9r01qp3g1rhb10d7j25k9r01qp3g1rhb1g';
  const PRICE_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?output=csv";
  const HISTORY_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?gid=648456386&single=true&output=csv"; 
  const CALC_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?gid=606181682&single=true&output=csv"; 

  const [assets, setAssets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('myAssets')) || []; } catch(e) { return []; }
  });
  const [history, setHistory] = useState([]);
  const [exchangeRate, setExchangeRate] = useState(32.5);
  const [loading, setLoading] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [range, setRange] = useState('全部');
  const [showUS, setShowUS] = useState(true);
  const [showTW, setShowTW] = useState(true);
  const [hoverData, setHoverData] = useState(null);

  const fetchRateFromCloud = useCallback(async () => {
    try {
      const res = await fetch(`${CALC_CSV_URL}&t=${Date.now()}`);
      const text = await res.text();
      const matches = text.match(/\d{2}\.\d+/g);
      if (matches) {
        const autoNum = parseFloat(matches[0]);
        if (autoNum > 28 && autoNum < 38) setExchangeRate(autoNum);
      }
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
      setHistory(cloudHistory);
    } catch (e) { console.error(e); }
  }, [HISTORY_CSV_URL]);

  useEffect(() => { fetchHistoryFromCloud(); fetchRateFromCloud(); }, [fetchHistoryFromCloud, fetchRateFromCloud]);
  useEffect(() => { localStorage.setItem('myAssets', JSON.stringify(assets)); }, [assets]);

  const refreshPrices = async () => {
    setLoading(true);
    try {
      await fetchRateFromCloud();
      const csvRes = await fetch(`${PRICE_CSV_URL}&t=${Date.now()}`);
      const csvText = await csvRes.text();
      const allNumbers = csvText.match(/\d+(\.\d+)?/g) || [];
      const backupPrice = parseFloat(allNumbers.find(n => parseFloat(n) > 5)) || 0;
      const updated = await Promise.all(assets.map(async (item) => {
        if (!item.symbol) return item;
        try {
          const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${item.symbol}&token=${API_KEY}`);
          const data = await res.json();
          if (data.c) return { ...item, price: data.c, prevClose: data.pc || data.c };
          if (/^\d/.test(item.symbol)) return { ...item, price: backupPrice, prevClose: backupPrice };
        } catch (e) {}
        return item;
      }));
      setAssets(updated);
      await fetchHistoryFromCloud();
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const calculateAsset = (item) => {
    const isUS = !/^\d/.test(item.symbol);
    const m = isUS ? exchangeRate : 1;
    const mv = (item.price || 0) * (item.shares || 0) * m;
    const costTWD = (item.totalCost || 0) * (isUS ? exchangeRate : 1); 
    const todayLoss = ((item.price || 0) - (item.prevClose || 0)) * (item.shares || 0) * m;
    const totalLoss = mv - costTWD;
    const percent = costTWD > 0 ? (totalLoss / costTWD) * 100 : 0;
    return { isUS, mv, today: todayLoss, total: totalLoss, percent };
  };

  const usAssets = assets.filter(a => !/^\d/.test(a.symbol));
  const twAssets = assets.filter(a => /^\d/.test(a.symbol));
  const sumData = (list) => list.reduce((acc, a) => {
    const d = calculateAsset(a);
    return { 
      mv: acc.mv + d.mv, 
      today: acc.today + d.today, 
      total: acc.total + d.total, 
      cost: acc.cost + (a.totalCost * (d.isUS ? exchangeRate : 1)) 
    };
  }, { mv: 0, today: 0, total: 0, cost: 0 });

  const usTotal = sumData(usAssets);
  const twTotal = sumData(twAssets);
  const grandTotal = { 
    mv: usTotal.mv + twTotal.mv, 
    today: usTotal.today + twTotal.today, 
    total: usTotal.total + twTotal.total,
    percent: (usTotal.cost + twTotal.cost) > 0 ? ((usTotal.total + twTotal.total) / (usTotal.cost + twTotal.cost)) * 100 : 0
  };

  const getFilteredData = () => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    let filtered = [];
    if (range === '今日') filtered = history.filter(h => h.ts > now - oneDay);
    else if (range === '5日') filtered = history.filter(h => h.ts > now - (5 * oneDay));
    else if (range === '本月') filtered = history.filter(h => h.ts > new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime());
    else if (range === '年初至今') filtered = history.filter(h => h.ts > new Date(new Date().getFullYear(), 0, 1).getTime());
    else filtered = history;

    if (filtered.length < 1) return { list: [], rangeDiff: 0, rangePercent: 0 };
    const firstVal = filtered[0].val;
    const lastVal = filtered[filtered.length - 1].val;
    const diff = lastVal - firstVal;
    const pct = firstVal !== 0 ? (diff / firstVal) * 100 : 0;
    return { list: filtered, rangeDiff: diff, rangePercent: pct };
  };

  const { list: drawData, rangeDiff, rangePercent } = getFilteredData();
  const maxV = Math.max(...drawData.map(h => h.val), 1);
  const minV = Math.min(...drawData.map(h => h.val), 0);
  const vRange = (maxV - minV) || 1;
  const polylinePath = drawData.length > 1 ? drawData.map((h, i) => `${(i / (drawData.length - 1)) * 100},${90 - ((h.val - minV) / vRange) * 80}`).join(' ') : "";

  // 輔助顏色函數：紅漲綠跌
  const getValueColor = (val) => (val >= 0 ? '#ef4444' : '#22c55e');

  return (
    <div style={{ padding: '20px', fontFamily: '-apple-system, sans-serif', maxWidth: '1000px', margin: '0 auto', background: '#f0f2f5', minHeight: '100vh' }}>
      
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginBottom: '15px' }}>
        <button onClick={refreshPrices} disabled={loading} style={{ padding: '10px 20px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold' }}>
          {loading ? '⚡ 同步中...' : '🔄 更新數據'}
        </button>
        <button onClick={() => setShowAdmin(!showAdmin)} style={{ padding: '10px 20px', background: '#1e293b', color: '#fff', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold' }}>⚙️ 設定資產</button>
      </div>

      {/* 總覽卡片 */}
      <div style={{ background: '#1e293b', color: '#fff', padding: '30px', borderRadius: '28px', marginBottom: '25px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
        <div style={{borderRight:'1px solid rgba(255,255,255,0.1)'}}><div style={{ fontSize: '13px', opacity: 0.6, marginBottom: '5px' }}>總市值 (TWD)</div><div style={{ fontSize: '22px', fontWeight: 'bold' }}>{Math.round(grandTotal.mv).toLocaleString()}</div></div>
        <div style={{borderRight:'1px solid rgba(255,255,255,0.1)'}}><div style={{ fontSize: '13px', opacity: 0.6, marginBottom: '5px' }}>累積損益</div><div style={{ fontSize: '22px', fontWeight: 'bold', color: getValueColor(grandTotal.total) }}>{Math.round(grandTotal.total).toLocaleString()} <span style={{fontSize:'14px'}}>({grandTotal.percent.toFixed(2)}%)</span></div></div>
        <div style={{borderRight:'1px solid rgba(255,255,255,0.1)'}}><div style={{ fontSize: '13px', opacity: 0.6, marginBottom: '5px' }}>今日損益</div><div style={{ fontSize: '22px', fontWeight: 'bold', color: getValueColor(grandTotal.today) }}>{grandTotal.today >= 0 ? '+' : ''}{Math.round(grandTotal.today).toLocaleString()}</div></div>
        <div style={{ textAlign: 'center' }}><div style={{ fontSize: '11px', opacity: 0.5, marginBottom: '5px' }}>即時匯率</div><div style={{ fontSize: '22px', fontWeight: 'bold', color: '#fbbf24' }}>{exchangeRate.toFixed(3)}</div></div>
      </div>

      {/* 歷史圖表與數據 */}
      <div style={{ background: '#fff', padding: '25px', borderRadius: '24px', marginBottom: '25px', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <b style={{ color: '#1e293b', fontSize: '18px' }}>📊 歷史資產水位</b>
              <div style={{ fontSize: '13px', display: 'flex', gap: '12px' }}>
                <span style={{ color: getValueColor(grandTotal.today), fontWeight: '600' }}>{grandTotal.today >= 0 ? '+' : ''}{Math.round(grandTotal.today).toLocaleString()} (今日)</span>
                <span style={{ color: getValueColor(rangeDiff), fontWeight: '600' }}>{rangeDiff >= 0 ? '+' : ''}{Math.round(rangeDiff).toLocaleString()} ({rangePercent.toFixed(2)}%) {range === '全部' ? '全部時間' : `過去${range}`}</span>
              </div>
            </div>
            {hoverData && <div style={{ fontSize: '12px', color: '#3b82f6', fontWeight: 'bold' }}>{new Date(hoverData.ts).toLocaleString()} : ${Math.round(hoverData.val).toLocaleString()}</div>}
          </div>
          <div style={{ display: 'flex', gap: '5px', background: '#f1f5f9', padding: '4px', borderRadius: '10px' }}>
            {['今日', '5日', '本月', '年初至今', '全部'].map(r => (
              <button key={r} onClick={() => setRange(r)} style={{ padding: '6px 12px', fontSize: '12px', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', background: range === r ? '#fff' : 'transparent', color: range === r ? '#3b82f6' : '#64748b' }}>{r}</button>
            ))}
          </div>
        </div>
        
        <div style={{ height: '180px', width: '100%', position: 'relative' }} onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const xPercent = (e.clientX - rect.left) / rect.width;
          const idx = Math.min(Math.max(Math.round(xPercent * (drawData.length - 1)), 0), drawData.length - 1);
          if(drawData[idx]) setHoverData({ ...drawData[idx], x: (idx / (drawData.length - 1)) * 100 });
        }} onMouseLeave={() => setHoverData(null)}>
          {drawData.length > 1 ? (
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
              <defs><linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity="0.2" /><stop offset="100%" stopColor="#3b82f6" stopOpacity="0" /></linearGradient></defs>
              {[0, 50, 100].map(v => <line key={v} x1="0" y1={v} x2="100" y2={v} stroke="#f1f5f9" strokeWidth="0.5" />)}
              <path d={`M 0 100 L ${polylinePath} L 100 100 Z`} fill="url(#lineGrad)" />
              <polyline points={polylinePath} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" />
              {hoverData && <>
                <line x1={hoverData.x} y1="0" x2={hoverData.x} y2="100" stroke="#3b82f6" strokeWidth="0.5" strokeDasharray="2" />
                <circle cx={hoverData.x} cy={90 - ((hoverData.val - minV) / vRange) * 80} r="1.5" fill="#3b82f6" stroke="#fff" strokeWidth="0.5" />
              </>}
            </svg>
          ) : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>無足夠歷史數據</div>}
        </div>
      </div>

      {/* 美股區塊 */}
      <div style={{ marginBottom: '15px' }}>
        <div onClick={() => setShowUS(!showUS)} style={{ background: '#fff', padding: '18px 25px', borderRadius: '20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '15px' }}>
            <b style={{ fontSize: '18px' }}>🇺🇸 美股資產 {showUS ? '▲' : '▼'}</b>
            <span style={{ fontSize: '15px', color: '#64748b', fontWeight: '500' }}>現值: {Math.round(usTotal.mv).toLocaleString()} TWD</span>
          </div>
          <div style={{ textAlign: 'right', fontSize: '13px', color: getValueColor(usTotal.today), fontWeight: 'bold' }}>今日: {usTotal.today >= 0 ? '+' : ''}{Math.round(usTotal.today).toLocaleString()}</div>
        </div>
        {showUS && <AssetTable list={usAssets} calc={calculateAsset} getValColor={getValueColor} />}
      </div>

      {/* 台股區塊 */}
      <div style={{ marginBottom: '30px' }}>
        <div onClick={() => setShowTW(!showTW)} style={{ background: '#fff', padding: '18px 25px', borderRadius: '20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '15px' }}>
            <b style={{ fontSize: '18px' }}>🇹🇼 台股資產 {showTW ? '▲' : '▼'}</b>
            <span style={{ fontSize: '15px', color: '#64748b', fontWeight: '500' }}>現值: {Math.round(twTotal.mv).toLocaleString()} TWD</span>
          </div>
          <div style={{ textAlign: 'right', fontSize: '13px', color: getValueColor(twTotal.today), fontWeight: 'bold' }}>今日: {twTotal.today >= 0 ? '+' : ''}{Math.round(twTotal.today).toLocaleString()}</div>
        </div>
        {showTW && <AssetTable list={twAssets} calc={calculateAsset} getValColor={getValueColor} />}
      </div>

      {/* 設定 Modal */}
      {showAdmin && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, backdropFilter: 'blur(4px)' }}>
          <div style={{ background: '#fff', padding: '30px', borderRadius: '24px', width: '90%', maxWidth: '500px' }}>
            <h3 style={{marginTop:0}}>⚙️ 設定資產</h3>
            {assets.map(item => (
              <div key={item.id} style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                <input style={{ flex: 1, padding: '10px' }} value={item.symbol} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, symbol: e.target.value.toUpperCase()} : a))} placeholder="代號" />
                <input style={{ width: '80px', padding: '10px' }} type="number" value={item.shares || ''} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, shares: parseFloat(e.target.value)} : a))} placeholder="股數" />
                <input style={{ width: '100px', padding: '10px' }} type="number" value={item.totalCost || ''} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, totalCost: parseFloat(e.target.value)} : a))} placeholder="總成本" />
                <button onClick={() => setAssets(assets.filter(a => a.id !== item.id))} style={{ color: '#ef4444', border: 'none', background: 'none', cursor: 'pointer' }}>✕</button>
              </div>
            ))}
            <button onClick={() => setAssets([...assets, { id: Date.now(), symbol: '', shares: 0, totalCost: 0 }])} style={{ width: '100%', padding: '12px', marginTop: '10px', border: '2px dashed #cbd5e1', borderRadius: '12px', cursor: 'pointer' }}>+ 新增項目</button>
            <button onClick={() => setShowAdmin(false)} style={{ width: '100%', padding: '15px', marginTop: '15px', background: '#1e293b', color: '#fff', borderRadius: '12px', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>儲存</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AssetTable({ list, calc, getValColor }) {
  return (
    <div style={{ background: '#fff', marginTop: '8px', borderRadius: '20px', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px' }}>
        <thead style={{ background: '#f8fafc' }}>
          <tr style={{ textAlign: 'left', color: '#64748b' }}><th style={{ padding: '15px 25px' }}>資產 / 股數</th><th style={{ padding: '15px 25px' }}>現值 (TWD)</th><th style={{ padding: '15px 25px' }}>累積損益</th><th style={{ padding: '15px 25px' }}>今日變動</th></tr>
        </thead>
        <tbody>
          {list.map(item => {
            const d = calc(item);
            return (
              <tr key={item.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ padding: '15px 25px' }}><div style={{ fontWeight: 'bold', fontSize: '16px' }}>{item.symbol}</div><div style={{ fontSize: '12px', color: '#94a3b8' }}>{item.shares.toLocaleString()} 股</div></td>
                <td style={{ padding: '15px 25px', fontWeight: '600' }}>{Math.round(d.mv).toLocaleString()}</td>
                <td style={{ padding: '15px 25px' }}><div style={{ color: getValColor(d.total), fontWeight: 'bold' }}>{Math.round(d.total).toLocaleString()} <span style={{ fontSize: '13px', marginLeft: '6px' }}>({d.percent >= 0 ? '+' : ''}{d.percent.toFixed(2)}%)</span></div></td>
                <td style={{ padding: '15px 25px', color: getValColor(d.today), fontWeight: 'bold' }}>{d.today >= 0 ? '+' : ''}{Math.round(d.today).toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default App;