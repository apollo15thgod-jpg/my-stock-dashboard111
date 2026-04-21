import React, { useState, useEffect, useCallback, useMemo } from 'react';

function App() {
  const API_KEY = 'd7j25k9r01qp3g1rhb10d7j25k9r01qp3g1rhb1g';
  const PRICE_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?output=csv";
  const HISTORY_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?gid=648456386&single=true&output=csv"; 
  const CALC_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?gid=606181682&single=true&output=csv"; 

  // --- 狀態管理 ---
  const [assets, setAssets] = useState(() => JSON.parse(localStorage.getItem('myAssets')) || []);
  const [otherAssets, setOtherAssets] = useState(() => JSON.parse(localStorage.getItem('myOtherAssets')) || []);
  const [liabilities, setLiabilities] = useState(() => JSON.parse(localStorage.getItem('myLiabilities')) || []);
  const [history, setHistory] = useState([]);
  const [exchangeRate, setExchangeRate] = useState(32.0);
  const [loading, setLoading] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  
  // 介面摺疊狀態
  const [showUS, setShowUS] = useState(true);
  const [showTW, setShowTW] = useState(true);
  const [showOther, setShowOther] = useState(true);
  const [showDebt, setShowDebt] = useState(true);

  // --- 抓取匯率 ---
  const fetchRateFromCloud = useCallback(async () => {
    try {
      const res = await fetch(`${CALC_CSV_URL}&t=${Date.now()}`);
      const text = await res.text();
      const matches = text.match(/\d{2}\.\d+/g) || [];
      if (matches.length > 0) setExchangeRate(Number(matches[0]));
    } catch (e) { console.error("匯率更新失敗", e); }
  }, [CALC_CSV_URL]);

  // --- 核心：刷新價格 (現價 A1, 昨日 A2) ---
  const refreshPrices = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await fetchRateFromCloud();
      const csvRes = await fetch(`${PRICE_CSV_URL}&t=${Date.now()}`);
      const csvText = await csvRes.text();
      const rows = csvText.split('\n').map(r => r.split(','));
      
      // 定義：A1 (rows[0][0]) 是現價，A2 (rows[1][0]) 是昨日收盤
      const twCurrentPrice = parseFloat(rows[0]?.[0]) || 0;
      const twPrevClose = parseFloat(rows[1]?.[0]) || twCurrentPrice;

      const updated = await Promise.all(assets.map(async (item) => {
        if (!item.symbol) return item;
        try {
          if (!/^\d/.test(item.symbol)) {
            // 美股使用 Finnhub API
            const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${item.symbol}&token=${API_KEY}`);
            const data = await res.json();
            if (data.c) return { ...item, price: data.c, prevClose: data.pc || data.c };
          } else {
            // 台股使用 Google Sheet 資料
            return { ...item, price: twCurrentPrice, prevClose: twPrevClose };
          }
        } catch (e) { console.error(`更新 ${item.symbol} 失敗`, e); }
        return item;
      }));
      setAssets(updated);
    } catch (e) { console.error("刷新流程錯誤", e); } finally { setLoading(false); }
  }, [assets, loading, fetchRateFromCloud, PRICE_CSV_URL, API_KEY]);

  // --- 初始化與存檔 ---
  useEffect(() => {
    refreshPrices();
    const fetchHist = async () => {
      try {
        const res = await fetch(`${HISTORY_CSV_URL}&t=${Date.now()}`);
        const text = await res.text();
        const rows = text.split('\n').slice(1);
        const data = rows.map(r => {
          const cols = r.split(',');
          return { ts: new Date(cols[0]).getTime(), val: parseFloat(cols[1]?.replace(/[^0-9.]/g, '')) };
        }).filter(h => h && !isNaN(h.val));
        setHistory(data.sort((a, b) => a.ts - b.ts));
      } catch (e) {}
    };
    fetchHist();
  }, [HISTORY_CSV_URL]);

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
    
    return {
      isUS, mv,
      today: mv - prevMv,
      total: mv - costTWD,
      totalPct: costTWD > 0 ? ((mv - costTWD) / costTWD) * 100 : 0
    };
  };

  const usAssets = assets.filter(a => !/^\d/.test(a.symbol));
  const twAssets = assets.filter(a => /^\d/.test(a.symbol));
  const sumOther = otherAssets.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
  const sumDebt = liabilities.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);

  const getSum = (list) => list.reduce((acc, a) => {
    const d = calculateAsset(a);
    return { 
      mv: acc.mv + d.mv, 
      today: acc.today + d.today, 
      total: acc.total + d.total,
      cost: acc.cost + (a.totalCost * (!/^\d/.test(a.symbol) ? exchangeRate : 1))
    };
  }, { mv: 0, today: 0, total: 0, cost: 0 });

  const usTotal = getSum(usAssets);
  const twTotal = getSum(twAssets);
  const netWorth = usTotal.mv + twTotal.mv + sumOther - sumDebt;

  const getColor = (val) => (val >= 0.1 ? '#ef4444' : val <= -0.1 ? '#22c55e' : '#64748b');

  return (
    <div style={{ padding: '12px', maxWidth: '600px', margin: '0 auto', background: '#f8fafc', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      
      {/* 總覽卡片 */}
      <div style={{ background: '#1e293b', color: '#fff', padding: '20px', borderRadius: '24px', marginBottom: '15px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.8, fontSize: '13px' }}>
          <span>淨資產估值 (TWD)</span>
          <span>匯率 {exchangeRate.toFixed(2)}</span>
        </div>
        <div style={{ fontSize: '32px', fontWeight: 'bold', margin: '12px 0' }}>{Math.round(netWorth).toLocaleString()}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '14px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px' }}>
          <div>今日股票: <span style={{ color: getColor(usTotal.today + twTotal.today), fontWeight: 'bold' }}>{Math.round(usTotal.today + twTotal.today).toLocaleString()}</span></div>
          <div style={{ textAlign: 'right' }}>累計損益: <span style={{ color: getColor(usTotal.total + twTotal.total), fontWeight: 'bold' }}>{Math.round(usTotal.total + twTotal.total).toLocaleString()}</span></div>
        </div>
      </div>

      {/* 股票區塊 */}
      <StockSection title="🇺🇸 美股資產" data={usTotal} list={usAssets} show={showUS} setShow={setShowUS} calc={calculateAsset} getColor={getColor} />
      <StockSection title="🇹🇼 台股資產" data={twTotal} list={twAssets} show={showTW} setShow={setShowTW} calc={calculateAsset} getColor={getColor} />

      {/* 銀行與負債 */}
      <SimpleSection title="🏦 銀行存款" total={sumOther} items={otherAssets} show={showOther} setShow={setShowOther} color="#3b82f6" />
      <SimpleSection title="💸 負債明細" total={sumDebt} items={liabilities} show={showDebt} setShow={setShowDebt} color="#94a3b8" isDebt />

      {/* 管理按鈕 */}
      <button onClick={() => setShowAdmin(true)} style={{ width: '100%', padding: '16px', borderRadius: '16px', background: '#fff', border: '1px solid #e2e8f0', fontWeight: 'bold', color: '#1e293b', cursor: 'pointer', marginTop: '10px' }}>⚙️ 資產配置管理</button>

      {/* 管理彈窗 */}
      {showAdmin && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '15px' }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: '450px', borderRadius: '24px', padding: '24px', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px' }}>
              <h3 style={{ margin: 0 }}>資產配置設定</h3>
              <button onClick={() => {setShowAdmin(false); refreshPrices();}} style={{ background:'#f1f5f9', border:'none', padding:'8px 15px', borderRadius:'10px', fontWeight:'bold' }}>儲存</button>
            </div>
            
            <p style={{ fontWeight: 'bold', fontSize: '14px', color: '#64748b' }}>📈 股票 (代號 / 股數 / 總成本TWD)</p>
            {assets.map(item => (
              <div key={item.id} style={{ display: 'flex', gap: '5px', marginBottom: '8px' }}>
                <input style={{ width: '80px', padding: '8px', border: '1px solid #ddd', borderRadius: '8px' }} value={item.symbol} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, symbol: e.target.value.toUpperCase()} : a))} />
                <input style={{ flex: 1, padding: '8px', border: '1px solid #ddd', borderRadius: '8px' }} type="number" value={item.shares} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, shares: parseFloat(e.target.value)} : a))} />
                <input style={{ flex: 1, padding: '8px', border: '1px solid #ddd', borderRadius: '8px' }} type="number" value={item.totalCost} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, totalCost: parseFloat(e.target.value)} : a))} />
                <button onClick={() => setAssets(assets.filter(a => a.id !== item.id))} style={{ background: 'none', border: 'none', color: '#ef4444' }}>✕</button>
              </div>
            ))}
            <button onClick={() => setAssets([...assets, { id: Date.now(), symbol: '', shares: 0, totalCost: 0 }])} style={{ width: '100%', padding: '10px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '8px', marginBottom: '20px' }}>+ 新增股票</button>

            <p style={{ fontWeight: 'bold', fontSize: '14px', color: '#64748b' }}>🏦 銀行存款 (項目 / 金額)</p>
            {otherAssets.map(item => (
              <div key={item.id} style={{ display: 'flex', gap: '5px', marginBottom: '8px' }}>
                <input style={{ flex: 2, padding: '8px', border: '1px solid #ddd', borderRadius: '8px' }} value={item.name} onChange={e => setOtherAssets(otherAssets.map(o => o.id === item.id ? {...o, name: e.target.value} : o))} />
                <input style={{ flex: 1, padding: '8px', border: '1px solid #ddd', borderRadius: '8px' }} type="number" value={item.amount} onChange={e => setOtherAssets(otherAssets.map(o => o.id === item.id ? {...o, amount: parseFloat(e.target.value)} : o))} />
                <button onClick={() => setOtherAssets(otherAssets.filter(o => o.id !== item.id))} style={{ background: 'none', border: 'none', color: '#ef4444' }}>✕</button>
              </div>
            ))}
            <button onClick={() => setOtherAssets([...otherAssets, { id: Date.now(), name: '', amount: 0 }])} style={{ width: '100%', padding: '10px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '8px', marginBottom: '20px' }}>+ 新增存款</button>

            <p style={{ fontWeight: 'bold', fontSize: '14px', color: '#64748b' }}>💸 負債 (項目 / 金額)</p>
            {liabilities.map(item => (
              <div key={item.id} style={{ display: 'flex', gap: '5px', marginBottom: '8px' }}>
                <input style={{ flex: 2, padding: '8px', border: '1px solid #ddd', borderRadius: '8px' }} value={item.name} onChange={e => setLiabilities(liabilities.map(l => l.id === item.id ? {...l, name: e.target.value} : l))} />
                <input style={{ flex: 1, padding: '8px', border: '1px solid #ddd', borderRadius: '8px' }} type="number" value={item.amount} onChange={e => setLiabilities(liabilities.map(l => l.id === item.id ? {...l, amount: parseFloat(e.target.value)} : l))} />
                <button onClick={() => setLiabilities(liabilities.filter(l => l.id !== item.id))} style={{ background: 'none', border: 'none', color: '#ef4444' }}>✕</button>
              </div>
            ))}
            <button onClick={() => setLiabilities([...liabilities, { id: Date.now(), name: '', amount: 0 }])} style={{ width: '100%', padding: '10px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '8px' }}>+ 新增負債</button>
          </div>
        </div>
      )}
    </div>
  );
}

// 子組件：股票列表
function StockSection({ title, data, list, show, setShow, calc, getColor }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div onClick={() => setShow(!show)} style={{ background: '#fff', padding: '16px', borderRadius: '18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', border: '1px solid #e2e8f0' }}>
        <b style={{ fontSize: '15px' }}>{title}</b>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 'bold' }}>{Math.round(data.mv).toLocaleString()}</div>
          <div style={{ fontSize: '12px', color: getColor(data.today) }}>今日 {data.today >= 0 ? '+' : ''}{Math.round(data.today).toLocaleString()}</div>
        </div>
      </div>
      {show && (
        <div style={{ background: '#fff', borderRadius: '16px', marginTop: '6px', overflow: 'hidden', border: '1px solid #f1f5f9' }}>
          {list.map(item => {
            const d = calc(item);
            return (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #f8fafc' }}>
                <div>
                  <div style={{ fontWeight: 'bold' }}>{item.symbol}</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>{item.shares.toLocaleString()} 股</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: '500' }}>{Math.round(d.mv).toLocaleString()}</div>
                  <div style={{ fontSize: '12px', color: getColor(d.today) }}>{d.today >= 0 ? '+' : ''}{Math.round(d.today).toLocaleString()}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 子組件：銀行與負債
function SimpleSection({ title, total, items, show, setShow, color, isDebt }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div onClick={() => setShow(!show)} style={{ background: '#fff', padding: '16px', borderRadius: '18px', display: 'flex', justifyContent: 'space-between', borderLeft: `6px solid ${color}`, cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
        <b style={{ fontSize: '15px' }}>{title}</b>
        <b style={{ color: isDebt ? '#ef4444' : '#1e293b' }}>{isDebt ? '-' : ''}{Math.round(total).toLocaleString()}</b>
      </div>
      {show && items.map(item => (
        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 20px', background: '#fff', borderTop: '1px solid #f1f5f9', fontSize: '14px' }}>
          <span>{item.name}</span>
          <span style={{ fontWeight: '500' }}>{Math.round(item.amount).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export default App;
