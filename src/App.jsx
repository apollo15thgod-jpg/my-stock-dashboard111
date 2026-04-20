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
  const [exchangeRate, setExchangeRate] = useState(32);
  const [loading, setLoading] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [range, setRange] = useState('全部');
  const [todayMode, setTodayMode] = useState('val'); 
  const [priceMode, setPriceMode] = useState('unit'); 

  // 1. 抓取匯率與歷史數據 (同前...)
  const fetchData = useCallback(async () => {
    try {
      const [rateRes, histRes] = await Promise.all([
        fetch(`${CALC_CSV_URL}&t=${Date.now()}`),
        fetch(`${HISTORY_CSV_URL}&t=${Date.now()}`)
      ]);
      const rateText = await rateRes.text();
      const matches = rateText.match(/\d{2}\.\d+/g) || [];
      const validRates = matches.map(Number).filter(n => n >= 28 && n <= 35);
      if (validRates.length > 0) setExchangeRate(validRates[0]);

      const histText = await histRes.text();
      const rows = histText.split('\n').slice(1); 
      const cloudHistory = rows.map(row => {
        const cols = row.split(',');
        if (cols.length < 2) return null;
        return { ts: new Date(cols[0]).getTime(), val: parseFloat(cols[1].replace(/[^0-9.]/g, '')) };
      }).filter(item => item && !isNaN(item.val));
      setHistory(cloudHistory.sort((a,b) => a.ts - b.ts));
    } catch (e) { console.error(e); }
  }, [CALC_CSV_URL, HISTORY_CSV_URL]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 2. 基本計算
  const calculateAsset = (item) => {
    const isUS = !/^\d/.test(item.symbol);
    const m = isUS ? exchangeRate : 1;
    const mv = (item.price || 0) * (item.shares || 0) * m;
    const prevMv = (item.prevClose || 0) * (item.shares || 0) * m;
    return { isUS, mv, today: mv - prevMv, todayPct: prevMv > 0 ? ((mv-prevMv)/prevMv)*100 : 0, unitPrice: item.price || 0 };
  };

  const totals = assets.reduce((acc, a) => {
    const d = calculateAsset(a);
    const cost = (a.totalCost || 0) * (d.isUS ? exchangeRate : 1);
    return { mv: acc.mv + d.mv, today: acc.today + d.today, cost: acc.cost + cost, prevMv: acc.prevMv + (d.mv - d.today) };
  }, { mv: 0, today: 0, cost: 0, prevMv: 0 });

  const grandTotal = { ...totals, total: totals.mv - totals.cost, percent: totals.cost > 0 ? ((totals.mv - totals.cost) / totals.cost) * 100 : 0 };

  // 3. 趨勢圖：刻度化繪圖邏輯 (Y每萬，X每天)
  const drawTrend = () => {
    const now = new Date();
    let startTime = 0;
    if (range === '今日') startTime = new Date().setHours(0,0,0,0);
    else if (range === '5日') startTime = now.getTime() - (5 * 86400000);
    else if (range === '本月') startTime = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    else if (range === '年初至今') startTime = new Date(now.getFullYear(), 0, 1).getTime();
    
    const filtered = range === '全部' ? history : history.filter(h => h.ts >= startTime);
    if (filtered.length < 2) return null;

    const vals = filtered.map(d => d.val);
    const minV = Math.floor(Math.min(...vals) / 10000) * 10000; // Y軸起點（萬位取整）
    const maxV = Math.ceil(Math.max(...vals) / 10000) * 10000;  // Y軸終點
    const vRange = maxV - minV || 10000;

    // Y軸刻度線（每1萬一條）
    const gridLines = [];
    for (let v = minV; v <= maxV; v += 10000) {
      gridLines.push(v);
    }

    // 計算點座標
    const points = filtered.map((h, i) => {
      const x = (i / (filtered.length - 1)) * 100;
      const y = 90 - ((h.val - minV) / vRange) * 80;
      return `${x},${y}`;
    }).join(' ');

    return { points, gridLines, minV, maxV, vRange, count: filtered.length };
  };

  const trendData = drawTrend();
  const getValueColor = (val) => (val >= 0 ? '#ef4444' : '#22c55e');

  return (
    <div style={{ padding: '12px', fontFamily: '-apple-system, sans-serif', maxWidth: '600px', margin: '0 auto', background: '#f8fafc', minHeight: '100vh' }}>
      
      {/* 總結資訊 */}
      <div style={{ background: '#1e293b', color: '#fff', padding: '20px', borderRadius: '24px', marginBottom: '15px' }}>
        <div style={{ fontSize: '12px', opacity: 0.6 }}>總市值 (TWD)</div>
        <div style={{ fontSize: '32px', fontWeight: 'bold', marginBottom: '15px' }}>{Math.round(grandTotal.mv).toLocaleString()}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '10px' }}>
          <div>
            <div style={{ fontSize: '11px', opacity: 0.6 }}>今日變動</div>
            <div style={{ fontWeight: 'bold', color: getValueColor(grandTotal.today) }}>{grandTotal.today >= 0 ? '+' : ''}{Math.round(grandTotal.today).toLocaleString()}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '11px', opacity: 0.6 }}>累積損益</div>
            <div style={{ fontWeight: 'bold', color: getValueColor(grandTotal.total) }}>{grandTotal.percent.toFixed(2)}%</div>
          </div>
        </div>
      </div>

      {/* 趨勢圖 (Y:每萬, X:每天) */}
      <div style={{ background: '#fff', padding: '20px', borderRadius: '24px', marginBottom: '15px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
        <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '20px', display: 'flex', justifyContent: 'space-between' }}>
          <span>📈 資產趨勢 (Y:1萬/格)</span>
          <span style={{ color: '#64748b', fontSize: '11px' }}>{range}點數: {trendData?.count || 0}</span>
        </div>

        <div style={{ height: '180px', width: '100%', position: 'relative', marginBottom: '15px' }}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
            {/* 繪製萬元刻度線 (Grid) */}
            {trendData?.gridLines.map(v => {
              const y = 90 - ((v - trendData.minV) / trendData.vRange) * 80;
              return (
                <g key={v}>
                  <line x1="0" y1={y} x2="100" y2={y} stroke="#f1f5f9" strokeWidth="0.5" />
                  <text x="-2" y={y + 1} fontSize="3" fill="#cbd5e1" textAnchor="end">{v/10000}萬</text>
                </g>
              );
            })}
            
            {/* 主折線 */}
            {trendData && (
              <polyline points={trendData.points} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </div>

        {/* 區間按鈕 */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {['5日', '本月', '年初至今', '全部'].map(r => (
            <button key={r} onClick={() => setRange(r)} style={{ flex: 1, padding: '10px 0', fontSize: '11px', border: 'none', borderRadius: '10px', background: range === r ? '#3b82f6' : '#f1f5f9', color: range === r ? '#fff' : '#64748b', fontWeight: 'bold' }}>{r}</button>
          ))}
        </div>
      </div>

      {/* 資產表格 (簡化顯示) */}
      <div style={{ background: '#fff', borderRadius: '20px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead style={{ background: '#f8fafc' }}>
            <tr style={{ textAlign: 'left', color: '#64748b' }}>
              <th style={{ padding: '12px' }}>資產</th>
              <th style={{ padding: '12px' }}>現價</th>
              <th style={{ padding: '12px' }}>今日</th>
              <th style={{ padding: '12px' }}>累積</th>
            </tr>
          </thead>
          <tbody>
            {assets.map(item => {
              const d = calculateAsset(item);
              const totalLoss = d.mv - (item.totalCost * (d.isUS ? exchangeRate : 1));
              return (
                <tr key={item.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px' }}><b>{item.symbol}</b></td>
                  <td style={{ padding: '12px' }}>{Math.round(d.mv).toLocaleString()}</td>
                  <td style={{ padding: '12px', color: getValueColor(d.today) }}>{d.todayPct.toFixed(1)}%</td>
                  <td style={{ padding: '12px', color: getValueColor(totalLoss) }}>{Math.round(totalLoss/1000)}k</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      
      {/* 設定入口 */}
      <div style={{ textAlign: 'center', marginTop: '20px' }}>
        <button onClick={() => setShowAdmin(true)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '12px' }}>⚙️ 修改資產配置</button>
      </div>

      {/* 管理彈窗 (同前) */}
      {showAdmin && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'flex-end', zIndex: 1000 }}>
          <div style={{ background: '#fff', width: '100%', padding: '20px', borderTopLeftRadius: '24px', borderTopRightRadius: '24px', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'15px' }}>
              <h3>⚙️ 設定</h3>
              <button onClick={()=>setShowAdmin(false)}>關閉</button>
            </div>
            {assets.map(a => (
              <div key={a.id} style={{ display: 'flex', gap: '5px', marginBottom: '8px' }}>
                <input style={{ flex: 1, padding: '8px' }} value={a.symbol} onChange={e => setAssets(assets.map(x => x.id === a.id ? {...x, symbol: e.target.value.toUpperCase()} : x))} />
                <input style={{ flex: 1, padding: '8px' }} type="number" value={a.shares} onChange={e => setAssets(assets.map(x => x.id === a.id ? {...x, shares: parseFloat(e.target.value)} : x))} />
                <input style={{ flex: 1, padding: '8px' }} type="number" value={a.totalCost} onChange={e => setAssets(assets.map(x => x.id === a.id ? {...x, totalCost: parseFloat(e.target.value)} : x))} />
                <button onClick={() => setAssets(assets.filter(x => x.id !== a.id))}>✕</button>
              </div>
            ))}
            <button onClick={() => setAssets([...assets, { id: Date.now(), symbol: '', shares: 0, totalCost: 0 }])} style={{ width: '100%', padding: '10px', marginTop: '10px' }}>+ 新增項目</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
