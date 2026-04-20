import React, { useState, useEffect, useCallback } from 'react';

function App() {
  const API_KEY = 'd7j25k9r01qp3g1rhb10d7j25k9r01qp3g1rhb1g';
  const PRICE_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?output=csv";
  const HISTORY_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?gid=648456386&single=true&output=csv"; 
  const CALC_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?gid=606181682&single=true&output=csv"; 

  const [assets, setAssets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('myAssets')) || []; } catch(e) { return []; }
  });
  const [liabilities, setLiabilities] = useState(() => {
    try { return JSON.parse(localStorage.getItem('myLiabilities')) || []; } catch(e) { return []; }
  });
  const [history, setHistory] = useState([]);
  const [exchangeRate, setExchangeRate] = useState(32.5);
  const [loading, setLoading] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [range, setRange] = useState('全部');
  const [showUS, setShowUS] = useState(true);
  const [showTW, setShowTW] = useState(true);
  const [showDebt, setShowDebt] = useState(true);
  const [todayMode, setTodayMode] = useState('val'); 

  // 修正後的匯率抓取邏輯
  const fetchRateFromCloud = useCallback(async () => {
    try {
      const res = await fetch(`${CALC_CSV_URL}&t=${Date.now()}`);
      const text = await res.text();
      const matches = text.match(/\d{2}\.\d+/g) || [];
      // 這裡排除掉像 50.58 這種不合理的數字
      const validRates = matches.map(Number).filter(n => n >= 28 && n <= 38);
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
      setHistory(cloudHistory);
    } catch (e) { console.error(e); }
  }, [HISTORY_CSV_URL]);

  useEffect(() => { fetchHistoryFromCloud(); fetchRateFromCloud(); }, [fetchHistoryFromCloud, fetchRateFromCloud]);
  useEffect(() => { localStorage.setItem('myAssets', JSON.stringify(assets)); }, [assets]);
  useEffect(() => { localStorage.setItem('myLiabilities', JSON.stringify(liabilities)); }, [liabilities]);

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
    } catch (e) {} finally { setLoading(false); }
  };

  const calculateAsset = (item) => {
    const isUS = !/^\d/.test(item.symbol);
    const m = isUS ? exchangeRate : 1;
    const mv = (item.price || 0) * (item.shares || 0) * m;
    const prevMv = (item.prevClose || 0) * (item.shares || 0) * m;
    const costTWD = (item.totalCost || 0) * (isUS ? exchangeRate : 1); 
    const todayLoss = mv - prevMv;
    const todayPct = prevMv > 0 ? (todayLoss / prevMv) * 100 : 0;
    const totalLoss = mv - costTWD;
    const totalPct = costTWD > 0 ? (totalLoss / costTWD) * 100 : 0;
    return { isUS, mv, today: todayLoss, todayPct, total: totalLoss, totalPct };
  };

  const usAssets = assets.filter(a => !/^\d/.test(a.symbol));
  const twAssets = assets.filter(a => /^\d/.test(a.symbol));
  const sumData = (list) => list.reduce((acc, a) => {
    const d = calculateAsset(a);
    return { mv: acc.mv + d.mv, today: acc.today + d.today, total: acc.total + d.total, cost: acc.cost + (a.totalCost * (d.isUS ? exchangeRate : 1)) };
  }, { mv: 0, today: 0, total: 0, cost: 0 });

  const usTotal = sumData(usAssets);
  const twTotal = sumData(twAssets);
  const totalDebt = liabilities.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  const grandTotal = { 
    mv: usTotal.mv + twTotal.mv, 
    today: usTotal.today + twTotal.today, 
    total: usTotal.total + twTotal.total,
    percent: (usTotal.cost + twTotal.cost) > 0 ? ((usTotal.total + twTotal.total) / (usTotal.cost + twTotal.cost)) * 100 : 0
  };

  const { list: drawData } = (() => {
    const now = Date.now();
    const oneDay = 86400000;
    let filtered = history;
    if (range === '今日') filtered = history.filter(h => h.ts > now - oneDay);
    else if (range === '5日') filtered = history.filter(h => h.ts > now - (5 * oneDay));
    return { list: filtered };
  })();

  const polylinePath = drawData.length > 1 ? drawData.map((h, i) => {
    const maxV = Math.max(...drawData.map(d => d.val), 1);
    const minV = Math.min(...drawData.map(d => d.val), 0);
    const vR = (maxV - minV) || 1;
    return `${(i / (drawData.length - 1)) * 100},${90 - ((h.val - minV) / vR) * 80}`;
  }).join(' ') : "";

  const getValueColor = (val) => (val >= 0 ? '#ef4444' : '#22c55e');

  return (
    <div style={{ 
      padding: '12px', 
      fontFamily: '-apple-system, system-ui, sans-serif', 
      maxWidth: '1000px', 
      margin: '0 auto', 
      minHeight: '100vh',
      backgroundImage: `linear-gradient(rgba(240, 242, 245, 0.75), rgba(240, 242, 245, 0.75)), url('https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?q=80&w=2067&auto=format&fit=crop')`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundAttachment: 'fixed',
      boxSizing: 'border-box'
    }}>
      
      {/* 操作按鈕 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '12px' }}>
        <button onClick={refreshPrices} disabled={loading} style={{ flex: 1, maxWidth: '120px', padding: '12px 0', background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(5px)', border: '1px solid #cbd5e1', borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}>
          {loading ? '⚡' : '🔄 更新'}
        </button>
        <button onClick={() => setShowAdmin(!showAdmin)} style={{ flex: 1, maxWidth: '120px', padding: '12px 0', background: '#1e293b', color: '#fff', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}>⚙️ 設定</button>
      </div>

      {/* 總覽卡片 */}
      <div style={{ 
        background: 'rgba(30, 41, 59, 0.95)', 
        backdropFilter: 'blur(10px)', 
        color: '#fff', 
        padding: '25px', 
        borderRadius: '24px', 
        marginBottom: '20px', 
        display: 'grid', 
        gridTemplateColumns: '1fr 1fr', 
        gap: '20px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)' 
      }}>
        <div style={{ borderRight: '1px solid rgba(255,255,255,0.1)', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '15px' }}>
          <div style={{ fontSize: '12px', opacity: 0.6, marginBottom: '4px' }}>總市值 (TWD)</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{Math.round(grandTotal.mv).toLocaleString()}</div>
        </div>
        <div style={{ textAlign: 'right', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '15px' }}>
          <div style={{ fontSize: '12px', opacity: 0.6, marginBottom: '4px' }}>即時匯率</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#fbbf24' }}>{exchangeRate.toFixed(2)}</div>
        </div>
        <div style={{ borderRight: '1px solid rgba(255,255,255,0.1)', paddingTop: '15px' }}>
          <div style={{ fontSize: '12px', opacity: 0.6, marginBottom: '4px' }}>今日損益</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: getValueColor(grandTotal.today) }}>
            {grandTotal.today >= 0 ? '+' : ''}{Math.round(grandTotal.today).toLocaleString()}
          </div>
        </div>
        <div style={{ textAlign: 'right', paddingTop: '15px' }}>
          <div style={{ fontSize: '12px', opacity: 0.6, marginBottom: '4px' }}>累積損益</div>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: getValueColor(grandTotal.total) }}>
            {Math.round(grandTotal.total).toLocaleString()}
            <div style={{ fontSize: '14px', opacity: 0.9 }}>({grandTotal.percent >= 0 ? '+' : ''}{grandTotal.percent.toFixed(2)}%)</div>
          </div>
        </div>
      </div>

      {/* 歷史趨勢 */}
      <div style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(10px)', padding: '16px', borderRadius: '24px', marginBottom: '20px', border: '1px solid rgba(255,255,255,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <b style={{ fontSize: '16px' }}>📊 歷史資產趨勢</b>
          <div style={{ display: 'flex', gap: '4px' }}>
            {['5日', '全部'].map(r => (
              <button key={r} onClick={() => setRange(r)} style={{ padding: '4px 10px', fontSize: '12px', border: 'none', borderRadius: '8px', background: range === r ? '#3b82f6' : 'rgba(0,0,0,0.05)', color: range === r ? '#fff' : '#64748b', fontWeight: '600' }}>{r}</button>
            ))}
          </div>
        </div>
        <div style={{ height: '120px', width: '100%' }}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
            <polyline points={polylinePath} fill="none" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      {/* 資產區塊 */}
      <MobileSection title="🇺🇸 美股資產" total={usTotal} show={showUS} setShow={setShowUS}>
        <AssetTable list={usAssets} calc={calculateAsset} getValColor={getValueColor} todayMode={todayMode} setTodayMode={setTodayMode} />
      </MobileSection>

      <MobileSection title="🇹🇼 台股資產" total={twTotal} show={showTW} setShow={setShowTW}>
        <AssetTable list={twAssets} calc={calculateAsset} getValColor={getValueColor} todayMode={todayMode} setTodayMode={setTodayMode} />
      </MobileSection>

      {/* 負債區塊 */}
      <div style={{ marginBottom: '40px' }}>
        <div onClick={() => setShowDebt(!showDebt)} style={{ background: 'rgba(255,255,255,0.8)', padding: '18px 20px', borderRadius: '20px', display: 'flex', justifyContent: 'space-between', alignItems:'center', borderLeft: '6px solid #94a3b8' }}>
          <b style={{ fontSize: '16px' }}>💸 負債紀錄 {showDebt ? '▲' : '▼'}</b>
          <span style={{ color: '#ef4444', fontWeight: 'bold' }}>-{Math.round(totalDebt).toLocaleString()}</span>
        </div>
        {showDebt && (
          <div style={{ background: 'rgba(255,255,255,0.9)', marginTop: '6px', borderRadius: '16px', overflow: 'hidden' }}>
            {liabilities.length > 0 ? liabilities.map(item => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '15px 20px', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                <span style={{fontWeight:'500'}}>{item.name}</span>
                <span style={{ color: '#ef4444', fontWeight: 'bold' }}>-{Math.round(item.amount).toLocaleString()}</span>
              </div>
            )) : <div style={{padding:'20px', textAlign:'center', color:'#94a3b8'}}>尚無資料</div>}
          </div>
        )}
      </div>

      {/* 設定 Modal */}
      {showAdmin && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div style={{ background: '#fff', padding: '24px', borderTopLeftRadius: '24px', borderTopRightRadius: '24px', width: '100%', maxHeight: '85vh', overflowY: 'auto', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0 }}>⚙️ 資產與負債設定</h3>
              <button onClick={() => setShowAdmin(false)} style={{ border: 'none', background: '#f1f5f9', padding: '8px 12px', borderRadius: '50%', fontSize: '16px' }}>✕</button>
            </div>
            <p style={{ fontWeight: 'bold', color: '#3b82f6', marginBottom: '10px' }}>📈 股票資產</p>
            {assets.map(item => (
              <div key={item.id} style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                <input style={{ flex: 1.2, padding: '12px', borderRadius: '10px', border: '1px solid #ddd', fontSize: '14px' }} value={item.symbol} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, symbol: e.target.value.toUpperCase()} : a))} placeholder="代號" />
                <input style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '1px solid #ddd', fontSize: '14px' }} type="number" value={item.shares || ''} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, shares: parseFloat(e.target.value)} : a))} placeholder="股數" />
                <input style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '1px solid #ddd', fontSize: '14px' }} type="number" value={item.totalCost || ''} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, totalCost: parseFloat(e.target.value)} : a))} placeholder="成本" />
                <button onClick={() => setAssets(assets.filter(a => a.id !== item.id))} style={{ padding: '0 10px', color: '#ef4444', border: 'none', background: 'none' }}>✕</button>
              </div>
            ))}
            <button onClick={() => setAssets([...assets, { id: Date.now(), symbol: '', shares: 0, totalCost: 0 }])} style={{ width: '100%', padding: '12px', marginBottom: '25px', border: '1px dashed #3b82f6', borderRadius: '12px', color: '#3b82f6', background: 'none', fontWeight: 'bold' }}>+ 新增股票</button>
            <p style={{ fontWeight: 'bold', color: '#ef4444', marginBottom: '10px' }}>💸 負債項目</p>
            {liabilities.map(item => (
              <div key={item.id} style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                <input style={{ flex: 2, padding: '12px', borderRadius: '10px', border: '1px solid #ddd', fontSize: '14px' }} value={item.name} onChange={e => setLiabilities(liabilities.map(l => l.id === item.id ? {...l, name: e.target.value} : l))} placeholder="信貸 / 房貸" />
                <input style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '1px solid #ddd', fontSize: '14px' }} type="number" value={item.amount || ''} onChange={e => setLiabilities(liabilities.map(l => l.id === item.id ? {...l, amount: parseFloat(e.target.value)} : l))} placeholder="金額" />
                <button onClick={() => setLiabilities(liabilities.filter(l => l.id !== item.id))} style={{ padding: '0 10px', color: '#ef4444', border: 'none', background: 'none' }}>✕</button>
              </div>
            ))}
            <button onClick={() => setLiabilities([...liabilities, { id: Date.now(), name: '', amount: 0 }])} style={{ width: '100%', padding: '12px', marginBottom: '25px', border: '1px dashed #ef4444', borderRadius: '12px', color: '#ef4444', background: 'none', fontWeight: 'bold' }}>+ 新增負債</button>
            <button onClick={() => setShowAdmin(false)} style={{ width: '100%', padding: '16px', background: '#1e293b', color: '#fff', borderRadius: '14px', border: 'none', fontWeight: 'bold', fontSize: '16px' }}>儲存並關閉</button>
          </div>
        </div>
      )}
    </div>
  );
}

function MobileSection({ title, total, show, setShow, children }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div onClick={() => setShow(!show)} style={{ background: 'rgba(255,255,255,0.8)', padding: '16px 20px', borderRadius: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(255,255,255,0.3)' }}>
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

function AssetTable({ list, calc, getValColor, todayMode, setTodayMode }) {
  return (
    <div style={{ overflowX: 'auto', background: 'rgba(255,255,255,0.9)', marginTop: '6px', borderRadius: '18px' }}>
      <table style={{ width: '100%', minWidth: '380px', borderCollapse: 'collapse', fontSize: '14px' }}>
        <thead style={{ background: 'rgba(0,0,0,0.03)' }}>
          <tr style={{ textAlign: 'left', color: '#64748b' }}>
            <th style={{ padding: '12px 15px' }}>資產/股數</th>
            <th style={{ padding: '12px 15px' }}>現值</th>
            <th style={{ padding: '12px 15px', textDecoration: 'underline dotted', cursor: 'pointer' }} onClick={() => setTodayMode(todayMode === 'val' ? 'pct' : 'val')}>今日變動</th>
            <th style={{ padding: '12px 15px' }}>累積損益</th>
          </tr>
        </thead>
        <tbody>
          {list.map(item => {
            const d = calc(item);
            return (
              <tr key={item.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '12px 15px' }}><div style={{ fontWeight: 'bold' }}>{item.symbol}</div><div style={{ fontSize: '11px', color: '#94a3b8' }}>{item.shares.toLocaleString()}</div></td>
                <td style={{ padding: '12px 15px' }}>{Math.round(d.mv).toLocaleString()}</td>
                <td style={{ padding: '12px 15px', color: getValColor(d.today), fontWeight: 'bold' }}>
                  {todayMode === 'val' ? (d.today >= 0 ? '+' : '') + Math.round(d.today).toLocaleString() : (d.todayPct >= 0 ? '+' : '') + d.todayPct.toFixed(2) + '%'}
                </td>
                <td style={{ padding: '12px 15px' }}>
                  <div style={{ color: getValColor(d.total), fontWeight: 'bold' }}>{d.totalPct.toFixed(1)}%</div>
                  <div style={{ fontSize: '11px', color: getValColor(d.total) }}>{Math.round(d.total).toLocaleString()}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default App;
