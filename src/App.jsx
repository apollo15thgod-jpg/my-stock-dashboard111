import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';

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

  // 使用 Ref 來儲存當前資產，方便在非同步過程中對比，防止閃爍
  const assetsRef = useRef(assets);
  useEffect(() => { assetsRef.current = assets; }, [assets]);

  // --- 數據抓取 ---
  const fetchRateFromCloud = useCallback(async () => {
    try {
      const res = await fetch(`${CALC_CSV_URL}&t=${Date.now()}`);
      const text = await res.text();
      const cleanText = text.replace(/,/g, ''); 
      const matches = cleanText.match(/\d{2}\.\d+/g) || [];
      const validRates = matches.map(Number).filter(n => n >= 28 && n <= 35);
      if (validRates.length > 0) setExchangeRate(validRates[0]);
    } catch (e) { console.error("匯率更新失敗"); }
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
    } catch (e) { console.error("歷史數據失敗"); }
  }, [HISTORY_CSV_URL]);

  // 核心：分離「手動/自動」邏輯，並解決閃爍 0 的問題
  const refreshPrices = useCallback(async (isManual = false) => {
    if (isManual) setLoading(true);
    try {
      if (isManual) {
        await fetchRateFromCloud();
        await fetchHistoryFromCloud();
      }

      const csvRes = await fetch(`${PRICE_CSV_URL}&t=${Date.now()}`);
      const csvText = await csvRes.text();
      const lines = csvText.split(/\r?\n/).map(line => line.replace(/[",]/g, '').trim());
      
      // 重要：確保抓到的數值有效，否則延用舊值
      const twCurrentPrice = parseFloat(lines[0]);
      const twYesterdayClose = parseFloat(lines[1]);

      const updated = await Promise.all(assetsRef.current.map(async (item) => {
        if (!item.symbol) return item;
        try {
          if (!/^\d/.test(item.symbol)) {
            const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${item.symbol}&token=${API_KEY}`);
            const data = await res.json();
            // 如果抓取失敗，保留原本的數值 (data.c || item.price)
            if (data.c) return { ...item, price: data.c, prevClose: data.pc || data.c };
          } else {
            // 台股邏輯：如果 CSV 抓取失敗 (NaN)，保留舊數值避免跳 0
            return { 
              ...item, 
              price: isNaN(twCurrentPrice) ? item.price : twCurrentPrice, 
              prevClose: isNaN(twYesterdayClose) ? item.prevClose : twYesterdayClose 
            };
          }
        } catch (e) { return item; }
        return item;
      }));
      
      // 深度對比，若完全沒變則不觸發渲染
      setAssets(prev => JSON.stringify(prev) === JSON.stringify(updated) ? prev : updated);
    } catch (e) { 
      console.error("更新中斷", e); 
    } finally { 
      if (isManual) setLoading(false); 
    }
  }, [fetchRateFromCloud, fetchHistoryFromCloud, PRICE_CSV_URL, API_KEY]);

  // 設定 10 秒計時器：安靜模式
  useEffect(() => {
    const timer = setInterval(() => {
      if (!showAdmin) {
        refreshPrices(false); 
      }
    }, 10000); 
    return () => clearInterval(timer);
  }, [refreshPrices, showAdmin]);

  // 初次載入
  useEffect(() => {
    refreshPrices(true);
  }, [refreshPrices]);

  useEffect(() => { localStorage.setItem('myAssets', JSON.stringify(assets)); }, [assets]);
  useEffect(() => { localStorage.setItem('myOtherAssets', JSON.stringify(otherAssets)); }, [otherAssets]);
  useEffect(() => { localStorage.setItem('myLiabilities', JSON.stringify(liabilities)); }, [liabilities]);

  // --- 計算核心 (加入 Fallback 避免 0) ---
  const calculateAsset = (item) => {
    const isUS = !/^\d/.test(item.symbol);
    const m = isUS ? exchangeRate : 1;
    const p = item.price || 0;
    // 如果 prevClose 是 0，則今日損益會變得很奇怪，這裡給予防禦
    const pc = (item.prevClose && item.prevClose !== 0) ? item.prevClose : p;

    const mv = p * (item.shares || 0) * m;
    const prevMv = pc * (item.shares || 0) * m;
    const costTWD = (item.totalCost || 0) * (isUS ? exchangeRate : 1); 
    
    const todayLoss = mv - prevMv;
    const todayPct = pc > 0 ? ((p - pc) / pc) * 100 : 0;
    const totalLoss = mv - costTWD;
    const totalPct = costTWD > 0 ? (totalLoss / costTWD) * 100 : 0;

    return { isUS, mv, today: todayLoss, todayPct, total: totalLoss, totalPct, unitPrice: p };
  };

  const usAssets = assets.filter(a => !/^\d/.test(a.symbol));
  const twAssets = assets.filter(a => /^\d/.test(a.symbol));
  const totalOtherAssets = otherAssets.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  const totalDebt = liabilities.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);

  const getSum = (list) => list.reduce((acc, a) => {
    const d = calculateAsset(a);
    const m = d.isUS ? exchangeRate : 1;
    return { 
      mv: acc.mv + d.mv, 
      today: acc.today + d.today, 
      total: acc.total + d.total, 
      cost: acc.cost + (a.totalCost * m) 
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

  const getValueColor = (val) => (val >= 0.01 ? '#ef4444' : val <= -0.01 ? '#22c55e' : '#64748b');

  return (
    <div style={{ padding: '12px', fontFamily: '-apple-system, system-ui, sans-serif', maxWidth: '1000px', margin: '0 auto', minHeight: '100vh', backgroundImage: `linear-gradient(rgba(240, 242, 245, 0.75), rgba(240, 242, 245, 0.75)), url('https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?q=80&w=2067&auto=format&fit=crop')`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed', boxSizing: 'border-box' }}>
      
      {/* 頂部按鈕 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '12px' }}>
        <button onClick={() => refreshPrices(true)} disabled={loading} style={{ flex: 1, maxWidth: '120px', padding: '12px 0', background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(5px)', border: '1px solid #cbd5e1', borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', position: 'relative' }}>
          {loading ? '⚡ 更新中' : '🔄 自動更新中'}
          {!loading && <span style={{ position:'absolute', top: '6px', right: '10px', width: '6px', height: '6px', background: '#22c55e', borderRadius: '50%', animation: 'pulse 1.5s infinite' }}></span>}
        </button>
        <button onClick={() => setShowAdmin(!showAdmin)} style={{ flex: 1, maxWidth: '120px', padding: '12px 0', background: '#1e293b', color: '#fff', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}>⚙️ 設定</button>
      </div>

      <style>{`@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; } }`}</style>

      {/* 總覽卡片 */}
      <div style={{ background: 'rgba(30, 41, 59, 0.95)', backdropFilter: 'blur(10px)', color: '#fff', padding: '25px', borderRadius: '24px', marginBottom: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
        <div style={{ borderRight: '1px solid rgba(255,255,255,0.1)', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '15px' }}>
          <div style={{ fontSize: '12px', opacity: 0.6, marginBottom: '4px' }}>總資產 (含存款)</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{Math.round(grandTotal.mv).toLocaleString()}</div>
        </div>
        <div style={{ textAlign: 'right', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '15px' }}>
          <div style={{ fontSize: '12px', opacity: 0.6, marginBottom: '4px' }}>即時匯率</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#fbbf24' }}>{exchangeRate.toFixed(2)}</div>
        </div>
        <div style={{ borderRight: '1px solid rgba(255,255,255,0.1)', paddingTop: '15px' }}>
          <div style={{ fontSize: '12px', opacity: 0.6, marginBottom: '4px' }}>今日股票損益</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: getValueColor(grandTotal.today) }}>{grandTotal.today >= 0 ? '+' : ''}{Math.round(grandTotal.today).toLocaleString()}</div>
        </div>
        <div style={{ textAlign: 'right', paddingTop: '15px' }}>
          <div style={{ fontSize: '12px', opacity: 0.6, marginBottom: '4px' }}>累積股票損益</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: getValueColor(grandTotal.total) }}>
            {Math.round(grandTotal.total).toLocaleString()}
            <div style={{ fontSize: '14px', opacity: 0.9 }}>({grandTotal.percent >= 0 ? '+' : ''}{grandTotal.percent.toFixed(2)}%)</div>
          </div>
        </div>
      </div>

      <MobileSection title="🇺🇸 美股資產" total={usTotal} show={showUS} setShow={setShowUS}>
        <AssetTable list={usAssets} calc={calculateAsset} getValColor={getValueColor} todayMode={todayMode} setTodayMode={setTodayMode} priceMode={priceMode} setPriceMode={setPriceMode} />
      </MobileSection>

      <MobileSection title="🇹🇼 台股資產" total={twTotal} show={showTW} setShow={setShowTW}>
        <AssetTable list={twAssets} calc={calculateAsset} getValColor={getValueColor} todayMode={todayMode} setTodayMode={setTodayMode} priceMode={priceMode} setPriceMode={setPriceMode} />
      </MobileSection>

      {/* 存款與負債 */}
      <div style={{ marginBottom: '12px' }}>
        <div onClick={() => setShowOther(!showOther)} style={{ background: 'rgba(255,255,255,0.8)', padding: '18px 20px', borderRadius: '20px', display: 'flex', justifyContent: 'space-between', alignItems:'center', borderLeft: '6px solid #3b82f6', cursor: 'pointer' }}>
          <b style={{ fontSize: '16px' }}>🏦 存款資產 {showOther ? '▲' : '▼'}</b>
          <span style={{ color: '#1e293b', fontWeight: 'bold' }}>{Math.round(totalOtherAssets).toLocaleString()}</span>
        </div>
        {showOther && (
          <div style={{ background: 'rgba(255,255,255,0.9)', marginTop: '6px', borderRadius: '16px', overflow: 'hidden' }}>
            {otherAssets.map(item => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '15px 20px', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                <span>{item.name}</span>
                <span style={{ fontWeight: 'bold' }}>{Math.round(item.amount).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAdmin && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div style={{ background: '#fff', padding: '24px', borderTopLeftRadius: '24px', borderTopRightRadius: '24px', width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}><h3>⚙️ 設定</h3><button onClick={() => setShowAdmin(false)}>✕</button></div>
            <p style={{ fontWeight: 'bold', color: '#3b82f6' }}>📈 股票</p>
            {assets.map(item => (
              <div key={item.id} style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
                <input style={{ flex: 1.2, padding: '10px' }} value={item.symbol} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, symbol: e.target.value.toUpperCase()} : a))} />
                <input style={{ flex: 1, padding: '10px' }} type="number" value={item.shares} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, shares: parseFloat(e.target.value)} : a))} />
                <input style={{ flex: 1, padding: '10px' }} type="number" value={item.totalCost} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, totalCost: parseFloat(e.target.value)} : a))} />
                <button onClick={() => setAssets(assets.filter(a => a.id !== item.id))}>✕</button>
              </div>
            ))}
            <button onClick={() => setAssets([...assets, { id: Date.now(), symbol: '', shares: 0, totalCost: 0 }])} style={{ width: '100%', padding: '10px', marginBottom: '15px' }}>+ 新增股票</button>
            <button onClick={() => setShowAdmin(false)} style={{ width: '100%', padding: '15px', background: '#1e293b', color: '#fff', borderRadius: '10px' }}>儲存</button>
          </div>
        </div>
      )}
    </div>
  );
}

function MobileSection({ title, total, show, setShow, children }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div onClick={() => setShow(!show)} style={{ background: 'rgba(255,255,255,0.8)', padding: '16px 20px', borderRadius: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(255,255,255,0.3)', cursor: 'pointer' }}>
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
    <div style={{ overflowX: 'auto', background: 'rgba(255,255,255,0.9)', marginTop: '6px', borderRadius: '18px' }}>
      <table style={{ width: '100%', minWidth: '380px', borderCollapse: 'collapse', fontSize: '14px' }}>
        <thead style={{ background: 'rgba(0,0,0,0.03)' }}>
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
              <tr key={item.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '12px 15px' }}><b>{item.symbol}</b><br/><small>{item.shares.toLocaleString()} 股</small></td>
                <td style={{ padding: '12px 15px' }}>{priceMode === 'unit' ? (d.isUS ? '$' : '') + d.unitPrice.toLocaleString() : Math.round(d.mv).toLocaleString()}</td>
                <td style={{ padding: '12px 15px', color: getValColor(d.today) }}>{todayMode === 'val' ? (d.today >= 0 ? '+' : '') + Math.round(d.today).toLocaleString() : (d.todayPct >= 0 ? '+' : '') + d.todayPct.toFixed(2) + '%'}</td>
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
