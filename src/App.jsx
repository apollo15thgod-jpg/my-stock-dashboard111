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
  const [showOther, setShowOther] = useState(true);
  const [showDebt, setShowDebt] = useState(true);
  const [todayMode, setTodayMode] = useState('val'); 
  const [priceMode, setPriceMode] = useState('unit');

  // 1. 抓取匯率
  const fetchRateFromCloud = useCallback(async () => {
    try {
      const res = await fetch(`${CALC_CSV_URL}&t=${Date.now()}`);
      const text = await res.text();
      const matches = text.match(/\d{2}\.\d+/g) || [];
      if (matches.length > 0) setExchangeRate(Number(matches[0]));
    } catch (e) { console.error("匯率失敗"); }
  }, [CALC_CSV_URL]);

  // 2. 核心：刷新報價 (邏輯：抓取 CSV 內的前兩個數字)
  const refreshPrices = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await fetchRateFromCloud();
      const csvRes = await fetch(`${PRICE_CSV_URL}&t=${Date.now()}`);
      const csvText = await csvRes.text();
      
      // 改用正則表達式抓取 CSV 內所有的數字 (包含小數點)
      // 這樣不管你的 A1, A2 夾雜了什麼文字，我們只拿數字
      const allNumbers = csvText.match(/-?\d+(\.\d+)?/g);
      
      if (!allNumbers || allNumbers.length < 1) {
        throw new Error("無法從 CSV 找到數字");
      }

      const twCurrentPrice = parseFloat(allNumbers[0]); // A1
      const twYesterdayClose = allNumbers.length >= 2 ? parseFloat(allNumbers[1]) : twCurrentPrice; // A2

      const updated = await Promise.all(assets.map(async (item) => {
        if (!item.symbol) return item;
        try {
          if (!/^\d/.test(item.symbol)) {
            // 美股 API
            const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${item.symbol}&token=${API_KEY}`);
            const data = await res.json();
            if (data.c) return { ...item, price: data.c, prevClose: data.pc || data.c };
          } else {
            // 台股：使用從 Google Sheet 抓到的前兩個數字
            return { ...item, price: twCurrentPrice, prevClose: twYesterdayClose };
          }
        } catch (e) {}
        return item;
      }));
      setAssets(updated);
    } catch (e) { 
      console.error("更新失敗", e); 
    } finally { 
      setLoading(false); 
    }
  }, [assets, loading, fetchRateFromCloud, PRICE_CSV_URL, API_KEY]);

  useEffect(() => {
    refreshPrices();
    const timer = setInterval(refreshPrices, 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => { localStorage.setItem('myAssets', JSON.stringify(assets)); }, [assets]);
  useEffect(() => { localStorage.setItem('myOtherAssets', JSON.stringify(otherAssets)); }, [otherAssets]);
  useEffect(() => { localStorage.setItem('myLiabilities', JSON.stringify(liabilities)); }, [liabilities]);

  // 計算邏輯
  const calculateAsset = (item) => {
    const isUS = !/^\d/.test(item.symbol);
    const m = isUS ? exchangeRate : 1;
    const p = item.price || 0;
    const pc = item.prevClose || p;
    const mv = p * (item.shares || 0) * m;
    const prevMv = pc * (item.shares || 0) * m;
    const costTWD = (item.totalCost || 0) * (isUS ? exchangeRate : 1);
    return { 
      isUS, mv, 
      today: mv - prevMv, 
      todayPct: pc > 0 ? ((p - pc) / pc) * 100 : 0,
      total: mv - costTWD, 
      totalPct: costTWD > 0 ? ((mv - costTWD) / costTWD) * 100 : 0,
      unitPrice: p 
    };
  };

  const usAssets = assets.filter(a => !/^\d/.test(a.symbol));
  const twAssets = assets.filter(a => /^\d/.test(a.symbol));
  const sumOther = otherAssets.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const sumDebt = liabilities.reduce((s, i) => s + (Number(i.amount) || 0), 0);

  const getSum = (list) => list.reduce((acc, a) => {
    const d = calculateAsset(a);
    const m = d.isUS ? exchangeRate : 1;
    return { mv: acc.mv + d.mv, today: acc.today + d.today, total: acc.total + d.total, cost: acc.cost + (a.totalCost * m) };
  }, { mv: 0, today: 0, total: 0, cost: 0 });

  const usTotal = getSum(usAssets);
  const twTotal = getSum(twAssets);
  const netWorth = usTotal.mv + twTotal.mv + sumOther - sumDebt;

  const getColor = (v) => v >= 0.01 ? '#ef4444' : v <= -0.01 ? '#22c55e' : '#64748b';

  return (
    <div style={{ padding: '12px', maxWidth: '600px', margin: '0 auto', background: '#f8fafc', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      
      {/* 頂部總覽 */}
      <div style={{ background: '#1e293b', color: '#fff', padding: '20px', borderRadius: '24px', marginBottom: '15px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.7, fontSize: '12px' }}>
          <span>淨資產 (TWD)</span>
          <span>匯率 {exchangeRate.toFixed(2)}</span>
        </div>
        <div style={{ fontSize: '32px', fontWeight: 'bold', margin: '10px 0' }}>{Math.round(netWorth).toLocaleString()}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', fontSize: '13px', borderTop: '1px solid #334155', paddingTop: '10px' }}>
          <div>今日: <span style={{ color: getColor(usTotal.today + twTotal.today) }}>{Math.round(usTotal.today + twTotal.today).toLocaleString()}</span></div>
          <div style={{ textAlign: 'right' }}>累計: <span style={{ color: getColor(usTotal.total + twTotal.total) }}>{Math.round(usTotal.total + twTotal.total).toLocaleString()}</span></div>
        </div>
      </div>

      <Section title="🇺🇸 美股資產" total={usTotal} show={showUS} setShow={setShowUS} color="#3b82f6">
        <AssetList list={usAssets} calc={calculateAsset} getColor={getColor} todayMode={todayMode} setTodayMode={setTodayMode} priceMode={priceMode} setPriceMode={setPriceMode} />
      </Section>

      <Section title="🇹🇼 台股資產" total={twTotal} show={showTW} setShow={setShowTW} color="#ef4444">
        <AssetList list={twAssets} calc={calculateAsset} getColor={getColor} todayMode={todayMode} setTodayMode={setTodayMode} priceMode={priceMode} setPriceMode={setPriceMode} />
      </Section>

      <SimpleSection title="🏦 銀行存款" total={sumOther} items={otherAssets} show={showOther} setShow={setShowOther} color="#10b981" />
      <SimpleSection title="💸 負債明細" total={sumDebt} items={liabilities} show={showDebt} setShow={setShowDebt} color="#64748b" isDebt />

      <button onClick={() => setShowAdmin(true)} style={{ width: '100%', padding: '15px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '15px', fontWeight: 'bold', marginTop: '10px' }}>⚙️ 資產配置管理</button>

      {/* 管理彈窗 */}
      {showAdmin && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ background: '#fff', width: '100%', padding: '20px', borderTopLeftRadius: '20px', borderTopRightRadius: '20px', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}><h3>設定</h3><button onClick={() => setShowAdmin(false)}>✕</button></div>
            
            <p style={{ fontWeight: 'bold', fontSize: '13px' }}>📈 股票 (代號 / 股數 / 總成本TWD)</p>
            {assets.map(item => (
              <div key={item.id} style={{ display: 'flex', gap: '5px', marginBottom: '5px' }}>
                <input style={{ flex: 1, padding: '8px', border: '1px solid #ddd' }} value={item.symbol} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, symbol: e.target.value.toUpperCase()} : a))} />
                <input style={{ flex: 1, padding: '8px', border: '1px solid #ddd' }} type="number" value={item.shares} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, shares: parseFloat(e.target.value)} : a))} />
                <input style={{ flex: 1, padding: '8px', border: '1px solid #ddd' }} type="number" value={item.totalCost} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, totalCost: parseFloat(e.target.value)} : a))} />
                <button onClick={() => setAssets(assets.filter(a => a.id !== item.id))}>✕</button>
              </div>
            ))}
            <button onClick={() => setAssets([...assets, { id: Date.now(), symbol: '', shares: 0, totalCost: 0 }])} style={{ width: '100%', padding: '8px', marginBottom: '15px' }}>+ 股票</button>

            <p style={{ fontWeight: 'bold', fontSize: '13px' }}>🏦 存款名稱 / 金額</p>
            {otherAssets.map(item => (
              <div key={item.id} style={{ display: 'flex', gap: '5px', marginBottom: '5px' }}>
                <input style={{ flex: 2, padding: '8px', border: '1px solid #ddd' }} value={item.name} onChange={e => setOtherAssets(otherAssets.map(o => o.id === item.id ? {...o, name: e.target.value} : o))} />
                <input style={{ flex: 1, padding: '8px', border: '1px solid #ddd' }} type="number" value={item.amount} onChange={e => setOtherAssets(otherAssets.map(o => o.id === item.id ? {...o, amount: parseFloat(e.target.value)} : o))} />
                <button onClick={() => setOtherAssets(otherAssets.filter(o => o.id !== item.id))}>✕</button>
              </div>
            ))}
            <button onClick={() => setOtherAssets([...otherAssets, { id: Date.now(), name: '', amount: 0 }])} style={{ width: '100%', padding: '8px', marginBottom: '15px' }}>+ 存款</button>

            <button onClick={() => {setShowAdmin(false); refreshPrices();}} style={{ width: '100%', padding: '15px', background: '#1e293b', color: '#fff', borderRadius: '10px' }}>儲存並關閉</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, total, show, setShow, color, children }) {
  return (
    <div style={{ marginBottom: '10px' }}>
      <div onClick={() => setShow(!show)} style={{ background: '#fff', padding: '15px', borderRadius: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderLeft: `5px solid ${color}` }}>
        <b style={{ fontSize: '14px' }}>{title} {show ? '▲' : '▼'}</b>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 'bold' }}>{Math.round(total.mv).toLocaleString()}</div>
          <div style={{ fontSize: '11px', color: total.today >= 0 ? '#ef4444' : '#22c55e' }}>{total.today >= 0 ? '+' : ''}{Math.round(total.today).toLocaleString()}</div>
        </div>
      </div>
      {show && children}
    </div>
  );
}

function AssetList({ list, calc, getColor, todayMode, setTodayMode, priceMode, setPriceMode }) {
  return (
    <div style={{ background: '#fff', marginTop: '5px', borderRadius: '15px', overflow: 'hidden', border: '1px solid #f1f5f9' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead style={{ background: '#f8fafc' }}>
          <tr style={{ color: '#64748b', textAlign: 'left' }}>
            <th style={{ padding: '10px' }}>代號</th>
            <th style={{ padding: '10px' }} onClick={() => setPriceMode(priceMode === 'unit' ? 'total' : 'unit')}>價格▼</th>
            <th style={{ padding: '10px' }} onClick={() => setTodayMode(todayMode === 'val' ? 'pct' : 'val')}>今日▼</th>
            <th style={{ padding: '10px' }}>累積</th>
          </tr>
        </thead>
        <tbody>
          {list.map(item => {
            const d = calc(item);
            return (
              <tr key={item.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px' }}><b>{item.symbol}</b><br/><small style={{color:'#94a3b8'}}>{item.shares}</small></td>
                <td style={{ padding: '10px' }}>{priceMode === 'unit' ? d.unitPrice.toLocaleString() : Math.round(d.mv).toLocaleString()}</td>
                <td style={{ padding: '10px', color: getColor(d.today) }}>{todayMode === 'val' ? (d.today >= 0 ? '+' : '') + Math.round(d.today).toLocaleString() : (d.todayPct >= 0 ? '+' : '') + d.todayPct.toFixed(2) + '%'}</td>
                <td style={{ padding: '10px', color: getColor(d.total), fontWeight: 'bold' }}>{d.totalPct.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SimpleSection({ title, total, items, show, setShow, color, isDebt }) {
  return (
    <div style={{ marginBottom: '10px' }}>
      <div onClick={() => setShow(!show)} style={{ background: '#fff', padding: '15px', borderRadius: '15px', display: 'flex', justifyContent: 'space-between', borderLeft: `5px solid ${color}` }}>
        <b style={{ fontSize: '14px' }}>{title} {show ? '▲' : '▼'}</b>
        <b style={{ color: isDebt ? '#ef4444' : '#334155' }}>{isDebt ? '-' : ''}{Math.round(total).toLocaleString()}</b>
      </div>
      {show && items.map(item => (
        <div key={item.id} style={{ background: '#fff', display: 'flex', justifyContent: 'space-between', padding: '10px 20px', borderTop: '1px solid #f1f5f9', fontSize: '13px' }}>
          <span>{item.name}</span>
          <span>{Math.round(item.amount).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export default App;
