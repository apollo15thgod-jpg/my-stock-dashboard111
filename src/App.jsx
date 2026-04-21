import React, { useState, useEffect, useCallback, useMemo } from 'react';

function App() {
  const API_KEY = 'd7j25k9r01qp3g1rhb10d7j25k9r01qp3g1rhb1g';
  const PRICE_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?output=csv";
  const HISTORY_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?gid=648456386&single=true&output=csv"; 
  const CALC_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?gid=606181682&single=true&output=csv"; 

  const [assets, setAssets] = useState(() => JSON.parse(localStorage.getItem('myAssets')) || []);
  const [otherAssets, setOtherAssets] = useState(() => JSON.parse(localStorage.getItem('myOtherAssets')) || []);
  const [liabilities, setLiabilities] = useState(() => JSON.parse(localStorage.getItem('myLiabilities')) || []);
  const [history, setHistory] = useState([]);
  const [exchangeRate, setExchangeRate] = useState(32.0);
  const [loading, setLoading] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showUS, setShowUS] = useState(true);
  const [showTW, setShowTW] = useState(true);
  const [todayMode, setTodayMode] = useState('val'); 
  const [priceMode, setPriceMode] = useState('unit');

  const fetchRateFromCloud = useCallback(async () => {
    try {
      const res = await fetch(`${CALC_CSV_URL}&t=${Date.now()}`);
      const text = await res.text();
      const matches = text.match(/\d{2}\.\d+/g) || [];
      if (matches.length > 0) setExchangeRate(Number(matches[0]));
    } catch (e) { console.error(e); }
  }, [CALC_CSV_URL]);

  const fetchHistoryFromCloud = useCallback(async () => {
    try {
      const res = await fetch(`${HISTORY_CSV_URL}&t=${Date.now()}`);
      const text = await res.text();
      const rows = text.split('\n').slice(1); 
      const cloudHistory = rows.map(row => {
        const cols = row.split(',');
        return { ts: new Date(cols[0]).getTime(), val: parseFloat(cols[1]?.replace(/[^0-9.]/g, '')) };
      }).filter(item => item && !isNaN(item.val));
      setHistory(cloudHistory.sort((a,b) => a.ts - b.ts));
    } catch (e) { console.error(e); }
  }, [HISTORY_CSV_URL]);

  // --- 核心修正：抓取 A1 作為台股報價 ---
  const refreshPrices = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await fetchRateFromCloud();
      const csvRes = await fetch(`${PRICE_CSV_URL}&t=${Date.now()}`);
      const csvText = await csvRes.text();
      
      // 將 CSV 轉成行列矩陣
      const rows = csvText.split('\n').map(r => r.split(','));
      
      // 根據您的需求：A1 是現價 (索引 0,0)，假設 B1 是昨收 (索引 0,1)
      // 如果試算表 B1 沒有昨收，請將 twPrevClose 改為抓取您試算表中對應的位置
      const twCurrentPrice = parseFloat(rows[0]?.[0]) || 0;
      const twPrevClose = parseFloat(rows[0]?.[1]) || twCurrentPrice;

      const updated = await Promise.all(assets.map(async (item) => {
        if (!item.symbol) return item;
        try {
          if (!/^\d/.test(item.symbol)) {
            // 美股 API
            const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${item.symbol}&token=${API_KEY}`);
            const data = await res.json();
            if (data.c) return { ...item, price: data.c, prevClose: data.pc || data.c };
          } else {
            // 台股：直接讀取 A1 (現價) 與 B1 (昨收)
            return { ...item, price: twCurrentPrice, prevClose: twPrevClose };
          }
        } catch (e) { console.error(e); }
        return item;
      }));
      setAssets(updated);
      await fetchHistoryFromCloud();
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [assets, loading, fetchRateFromCloud, fetchHistoryFromCloud, PRICE_CSV_URL, API_KEY]);

  useEffect(() => {
    const timer = setInterval(() => refreshPrices(), 60000);
    return () => clearInterval(timer);
  }, [refreshPrices]);

  useEffect(() => { fetchHistoryFromCloud(); fetchRateFromCloud(); }, [fetchHistoryFromCloud, fetchRateFromCloud]);
  useEffect(() => { localStorage.setItem('myAssets', JSON.stringify(assets)); }, [assets]);
  useEffect(() => { localStorage.setItem('myOtherAssets', JSON.stringify(otherAssets)); }, [otherAssets]);
  useEffect(() => { localStorage.setItem('myLiabilities', JSON.stringify(liabilities)); }, [liabilities]);

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

  const getValueColor = (val) => (val >= 0.1 ? '#ef4444' : val <= -0.1 ? '#22c55e' : '#64748b');

  return (
    <div style={{ padding: '12px', fontFamily: '-apple-system, sans-serif', maxWidth: '800px', margin: '0 auto', background: '#f8fafc', minHeight: '100vh' }}>
      
      {/* 總覽卡片 */}
      <div style={{ background: '#1e293b', color: '#fff', padding: '20px', borderRadius: '20px', marginBottom: '15px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
        <div>
          <div style={{ fontSize: '12px', opacity: 0.7 }}>總資產 (含存款)</div>
          <div style={{ fontSize: '22px', fontWeight: 'bold' }}>{Math.round(grandTotal.mv).toLocaleString()}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '12px', opacity: 0.7 }}>匯率 (USD/TWD)</div>
          <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#fbbf24' }}>{exchangeRate.toFixed(2)}</div>
        </div>
        <div>
          <div style={{ fontSize: '12px', opacity: 0.7 }}>今日股票損益</div>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: getValueColor(grandTotal.today) }}>
            {grandTotal.today >= 0 ? '+' : ''}{Math.round(grandTotal.today).toLocaleString()}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '12px', opacity: 0.7 }}>累積總回報率</div>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: getValueColor(grandTotal.total) }}>{grandTotal.percent.toFixed(2)}%</div>
        </div>
      </div>

      {/* 趨勢圖 */}
      <div style={{ background: '#fff', padding: '15px', borderRadius: '20px', marginBottom: '15px', border: '1px solid #e2e8f0' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px' }}>
          <b>📊 資產趨勢圖</b>
          <button onClick={refreshPrices} disabled={loading} style={{ fontSize:'12px', padding:'4px 10px', borderRadius:'8px', cursor:'pointer' }}>{loading ? '更新中...' : '手動刷新'}</button>
        </div>
        <div style={{ height: '140px', width: '100%', position: 'relative', paddingLeft: '35px' }}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
            {chartData?.yTicks.map(tick => {
              const y = 100 - ((tick - chartData.minV) / chartData.vRange) * 100;
              return (
                <g key={tick}>
                  <line x1="0" y1={y} x2="100" y2={y} stroke="#f1f5f9" strokeWidth="0.5" />
                  <text x="-3" y={y} fontSize="3.5" fill="#94a3b8" textAnchor="end" dominantBaseline="middle">{tick / 10000}萬</text>
                </g>
              );
            })}
            {chartData && <polyline points={chartData.points} fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
          </svg>
        </div>
      </div>

      <MobileSection title="🇺🇸 美股資產" total={usTotal} show={showUS} setShow={setShowUS}>
        <AssetTable list={usAssets} calc={calculateAsset} getValColor={getValueColor} todayMode={todayMode} setTodayMode={setTodayMode} priceMode={priceMode} setPriceMode={setPriceMode} />
      </MobileSection>

      <MobileSection title="🇹🇼 台股資產" total={twTotal} show={showTW} setShow={setShowTW}>
        <AssetTable list={twAssets} calc={calculateAsset} getValColor={getValueColor} todayMode={todayMode} setTodayMode={setTodayMode} priceMode={priceMode} setPriceMode={setPriceMode} />
      </MobileSection>

      <div style={{ marginTop: '20px' }}>
        <button onClick={() => setShowAdmin(true)} style={{ width: '100%', padding: '15px', borderRadius: '12px', background: '#1e293b', color: '#fff', border: 'none', fontWeight: 'bold', fontSize: '16px', cursor: 'pointer' }}>⚙️ 資產配置管理</button>
      </div>

      {showAdmin && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '15px' }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: '500px', borderRadius: '20px', padding: '20px', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
              <h3 style={{ margin: 0 }}>⚙️ 配置管理</h3>
              <button onClick={() => setShowAdmin(false)} style={{ border: 'none', background: 'none', fontSize: '20px', cursor: 'pointer' }}>✕</button>
            </div>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '15px' }}>台股代號請輸入數字 (如: 0050)，美股請輸入英文 (如: TSLA)</p>
            {assets.map(item => (
              <div key={item.id} style={{ display: 'flex', gap: '5px', marginBottom: '10px' }}>
                <input style={{ flex: 1, padding: '10px', border: '1px solid #ddd', borderRadius: '8px' }} value={item.symbol} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, symbol: e.target.value.toUpperCase()} : a))} placeholder="代號" />
                <input style={{ flex: 1, padding: '10px', border: '1px solid #ddd', borderRadius: '8px' }} type="number" value={item.shares} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, shares: parseFloat(e.target.value)} : a))} placeholder="股數" />
                <input style={{ flex: 1.2, padding: '10px', border: '1px solid #ddd', borderRadius: '8px' }} type="number" value={item.totalCost} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, totalCost: parseFloat(e.target.value)} : a))} placeholder="總成本(TWD)" />
                <button onClick={() => setAssets(assets.filter(a => a.id !== item.id))} style={{ background: '#fee2e2', color: '#ef4444', border: 'none', padding: '0 12px', borderRadius: '8px' }}>✕</button>
              </div>
            ))}
            <button onClick={() => setAssets([...assets, { id: Date.now(), symbol: '', shares: 0, totalCost: 0 }])} style={{ width: '100%', padding: '12px', marginBottom: '15px', borderRadius: '10px', border: '2px dashed #cbd5e1', background: 'none', cursor: 'pointer' }}>+ 新增股票</button>
            <button onClick={() => setShowAdmin(false)} style={{ width: '100%', padding: '15px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '12px', fontWeight: 'bold' }}>儲存配置</button>
          </div>
        </div>
      )}
    </div>
  );
}

function MobileSection({ title, total, show, setShow, children }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div onClick={() => setShow(!show)} style={{ background: '#fff', padding: '15px 20px', borderRadius: '18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #e2e8f0', cursor: 'pointer' }}>
        <b style={{ fontSize: '15px' }}>{title} {show ? '▲' : '▼'}</b>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '15px', fontWeight: 'bold' }}>{Math.round(total.mv).toLocaleString()}</div>
          <div style={{ fontSize: '12px', color: total.today >= 0 ? '#ef4444' : '#22c55e', fontWeight: 'bold' }}>
            今日 {total.today >= 0 ? '+' : ''}{Math.round(total.today).toLocaleString()}
          </div>
        </div>
      </div>
      {show && children}
    </div>
  );
}

function AssetTable({ list, calc, getValColor, todayMode, setTodayMode, priceMode, setPriceMode }) {
  return (
    <div style={{ overflowX: 'auto', background: '#fff', marginTop: '6px', borderRadius: '15px', border: '1px solid #e2e8f0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead style={{ background: '#f8fafc' }}>
          <tr style={{ textAlign: 'left', color: '#64748b' }}>
            <th style={{ padding: '12px' }}>資產</th>
            <th style={{ padding: '12px', cursor: 'pointer' }} onClick={() => setPriceMode(priceMode === 'total' ? 'unit' : 'total')}>{priceMode === 'unit' ? '現價' : '現值'}</th>
            <th style={{ padding: '12px', cursor: 'pointer' }} onClick={() => setTodayMode(todayMode === 'val' ? 'pct' : 'val')}>今日損益</th>
            <th style={{ padding: '12px' }}>總回報</th>
          </tr>
        </thead>
        <tbody>
          {list.map(item => {
            const d = calc(item);
            return (
              <tr key={item.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ padding: '12px' }}><b>{item.symbol}</b><div style={{fontSize:'11px', color:'#94a3b8'}}>{item.shares.toLocaleString()} 股</div></td>
                <td style={{ padding: '12px' }}>{priceMode === 'unit' ? (d.isUS ? '$' : '') + d.unitPrice.toLocaleString() : Math.round(d.mv).toLocaleString()}</td>
                <td style={{ padding: '12px', color: getValColor(d.today), fontWeight: 'bold' }}>
                  {todayMode === 'val' ? (d.today >= 0 ? '+' : '') + Math.round(d.today).toLocaleString() : (d.todayPct >= 0 ? '+' : '') + d.todayPct.toFixed(2) + '%'}
                </td>
                <td style={{ padding: '12px', color: getValColor(d.total), fontWeight: 'bold' }}>{d.totalPct.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default App;
