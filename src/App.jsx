import React, { useState, useEffect, useCallback, useMemo } from 'react';

function App() {
  const API_KEY = 'd7j25k9r01qp3g1rhb10d7j25k9r01qp3g1rhb1g';
  const PRICE_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?output=csv";
  const HISTORY_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?gid=648456386&single=true&output=csv"; 
  const CALC_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?gid=606181682&single=true&output=csv"; 

  const [assets, setAssets] = useState(() => JSON.parse(localStorage.getItem('myAssets')) || []);
  const [otherAssets, setOtherAssets] = useState(() => JSON.parse(localStorage.getItem('myOtherAssets')) || []);
  const [liabilities, setLiabilities] = useState(() => JSON.parse(localStorage.getItem('myLiabilities')) || []);
  const [exchangeRate, setExchangeRate] = useState(32.0);
  const [loading, setLoading] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showUS, setShowUS] = useState(true);
  const [showTW, setShowTW] = useState(true);
  const [todayMode, setTodayMode] = useState('val'); 
  const [priceMode, setPriceMode] = useState('unit');

  // 1. 抓取匯率 (過濾掉逗號)
  const fetchRateFromCloud = useCallback(async () => {
    try {
      const res = await fetch(`${CALC_CSV_URL}&t=${Date.now()}`);
      const text = await res.text();
      const cleanText = text.replace(/,/g, ''); // 移除千分位逗號
      const matches = cleanText.match(/\d{2}\.\d+/g) || [];
      if (matches.length > 0) setExchangeRate(Number(matches[0]));
    } catch (e) { console.error("匯率失敗"); }
  }, [CALC_CSV_URL]);

  // 2. 核心：刷新報價 (嚴格處理 A1, A2)
  const refreshPrices = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await fetchRateFromCloud();
      const csvRes = await fetch(`${PRICE_CSV_URL}&t=${Date.now()}`);
      const csvText = await csvRes.text();
      
      // 處理 Google CSV 特有的引號問題並解析行
      // 邏輯：先移除所有千分位逗號，但要小心不要破壞 CSV 列分割
      // 我們逐行處理，每一行只拿第一個數字
      const rows = csvText.split(/\r?\n/).map(row => {
        // 移除引號與逗號，只保留數字與小數點
        const cleanRow = row.replace(/"/g, '').replace(/,/g, ''); 
        return cleanRow.trim();
      });

      // A1 是第一行第一個數字，A2 是第二行第一個數字
      const twCurrentPrice = parseFloat(rows[0]) || 0;
      const twYesterdayClose = parseFloat(rows[1]) || twCurrentPrice;

      console.log("台股報價偵錯:", { 現價A1: twCurrentPrice, 昨收A2: twYesterdayClose });

      const updated = await Promise.all(assets.map(async (item) => {
        if (!item.symbol) return item;
        try {
          if (!/^\d/.test(item.symbol)) {
            const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${item.symbol}&token=${API_KEY}`);
            const data = await res.json();
            if (data.c) return { ...item, price: data.c, prevClose: data.pc || data.c };
          } else {
            // 套用台股 A1/A2
            return { ...item, price: twCurrentPrice, prevClose: twYesterdayClose };
          }
        } catch (e) {}
        return item;
      }));
      setAssets(updated);
    } catch (e) { console.error("更新失敗", e); } finally { setLoading(false); }
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
  const totalStockToday = usTotal.today + twTotal.today;
  const netWorth = usTotal.mv + twTotal.mv + sumOther - sumDebt;

  const getColor = (v) => v >= 0.01 ? '#ef4444' : v <= -0.01 ? '#22c55e' : '#64748b';

  return (
    <div style={{ padding: '12px', maxWidth: '600px', margin: '0 auto', background: '#f8fafc', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      
      {/* 總覽卡片 */}
      <div style={{ background: '#1e293b', color: '#fff', padding: '25px', borderRadius: '24px', marginBottom: '15px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.7, fontSize: '12px', marginBottom: '8px' }}>
          <span>淨資產估值 (TWD)</span>
          <span>匯率 {exchangeRate.toFixed(2)}</span>
        </div>
        <div style={{ fontSize: '36px', fontWeight: 'bold', letterSpacing: '-1px' }}>{Math.round(netWorth).toLocaleString()}</div>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', marginTop: '20px', paddingTop: '15px', borderTop: '1px solid #334155' }}>
          <div>
            <div style={{ fontSize: '11px', opacity: 0.6 }}>今日股票損益</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: getColor(totalStockToday) }}>
              {totalStockToday >= 0 ? '+' : ''}{Math.round(totalStockToday).toLocaleString()}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '11px', opacity: 0.6 }}>股票累計損益</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: getColor(usTotal.total + twTotal.total) }}>
              {Math.round(usTotal.total + twTotal.total).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      <AssetSection title="🇺🇸 美股資產" total={usTotal} show={showUS} setShow={setShowUS} color="#3b82f6">
        <AssetTable list={usAssets} calc={calculateAsset} getColor={getColor} todayMode={todayMode} setTodayMode={setTodayMode} priceMode={priceMode} setPriceMode={setPriceMode} />
      </AssetSection>

      <AssetSection title="🇹🇼 台股資產" total={twTotal} show={showTW} setShow={setShowTW} color="#ef4444">
        <AssetTable list={twAssets} calc={calculateAsset} getColor={getColor} todayMode={todayMode} setTodayMode={setTodayMode} priceMode={priceMode} setPriceMode={setPriceMode} />
      </AssetSection>

      <SimpleSection title="🏦 銀行存款" total={sumOther} items={otherAssets} color="#10b981" />
      <SimpleSection title="💸 負債明細" total={sumDebt} items={liabilities} color="#64748b" isDebt />

      <button onClick={() => setShowAdmin(true)} style={{ width: '100%', padding: '16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '16px', fontWeight: 'bold', marginTop: '10px', color: '#475569' }}>⚙️ 資產配置管理</button>

      {/* 設定 Modal */}
      {showAdmin && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ background: '#fff', width: '100%', padding: '24px', borderTopLeftRadius: '24px', borderTopRightRadius: '24px', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}><h3>管理資產</h3><button onClick={() => setShowAdmin(false)} style={{ fontSize: '24px', border: 'none', background: 'none' }}>✕</button></div>
            
            <p style={{ fontWeight: 'bold', fontSize: '14px', color: '#3b82f6' }}>📈 股票 (代號 / 股數 / 總成本TWD)</p>
            {assets.map(item => (
              <div key={item.id} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input style={{ flex: 1, padding: '10px', border: '1px solid #ddd', borderRadius: '8px' }} value={item.symbol} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, symbol: e.target.value.toUpperCase()} : a))} />
                <input style={{ flex: 1, padding: '10px', border: '1px solid #ddd', borderRadius: '8px' }} type="number" value={item.shares} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, shares: parseFloat(e.target.value)} : a))} />
                <input style={{ flex: 1.2, padding: '10px', border: '1px solid #ddd', borderRadius: '8px' }} type="number" value={item.totalCost} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, totalCost: parseFloat(e.target.value)} : a))} />
                <button onClick={() => setAssets(assets.filter(a => a.id !== item.id))} style={{ color: '#ef4444', border: 'none', background: 'none' }}>✕</button>
              </div>
            ))}
            <button onClick={() => setAssets([...assets, { id: Date.now(), symbol: '', shares: 0, totalCost: 0 }])} style={{ width: '100%', padding: '10px', marginBottom: '20px', border: '1px dashed #cbd5e1', borderRadius: '8px' }}>+ 新增股票</button>

            <p style={{ fontWeight: 'bold', fontSize: '14px', color: '#10b981' }}>🏦 存款名稱 / 金額</p>
            {otherAssets.map(item => (
              <div key={item.id} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input style={{ flex: 2, padding: '10px', border: '1px solid #ddd', borderRadius: '8px' }} value={item.name} onChange={e => setOtherAssets(otherAssets.map(o => o.id === item.id ? {...o, name: e.target.value} : o))} />
                <input style={{ flex: 1, padding: '10px', border: '1px solid #ddd', borderRadius: '8px' }} type="number" value={item.amount} onChange={e => setOtherAssets(otherAssets.map(o => o.id === item.id ? {...o, amount: parseFloat(e.target.value)} : o))} />
                <button onClick={() => setOtherAssets(otherAssets.filter(o => o.id !== item.id))} style={{ color: '#ef4444', border: 'none', background: 'none' }}>✕</button>
              </div>
            ))}
            <button onClick={() => setOtherAssets([...otherAssets, { id: Date.now(), name: '', amount: 0 }])} style={{ width: '100%', padding: '10px', marginBottom: '20px', border: '1px dashed #cbd5e1', borderRadius: '8px' }}>+ 新增存款</button>

            <button onClick={() => {setShowAdmin(false); refreshPrices();}} style={{ width: '100%', padding: '16px', background: '#1e293b', color: '#fff', borderRadius: '12px', fontWeight: 'bold' }}>儲存配置</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AssetSection({ title, total, show, setShow, color, children }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div onClick={() => setShow(!show)} style={{ background: '#fff', padding: '18px', borderRadius: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderLeft: `6px solid ${color}`, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <b style={{ fontSize: '15px' }}>{title} {show ? '▲' : '▼'}</b>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 'bold', fontSize: '16px' }}>{Math.round(total.mv).toLocaleString()}</div>
          <div style={{ fontSize: '12px', color: total.today >= 0 ? '#ef4444' : '#22c55e', fontWeight: 'bold' }}>{total.today >= 0 ? '+' : ''}{Math.round(total.today).toLocaleString()}</div>
        </div>
      </div>
      {show && children}
    </div>
  );
}

function AssetTable({ list, calc, getColor, todayMode, setTodayMode, priceMode, setPriceMode }) {
  return (
    <div style={{ background: '#fff', marginTop: '6px', borderRadius: '18px', overflow: 'hidden', border: '1px solid #f1f5f9' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead style={{ background: '#f8fafc' }}>
          <tr style={{ color: '#64748b', textAlign: 'left' }}>
            <th style={{ padding: '12px' }}>標的</th>
            <th style={{ padding: '12px', cursor: 'pointer' }} onClick={() => setPriceMode(priceMode==='unit'?'total':'unit')}>現價/值</th>
            <th style={{ padding: '12px', cursor: 'pointer' }} onClick={() => setTodayMode(todayMode==='val'?'pct':'val')}>今日漲跌</th>
            <th style={{ padding: '12px' }}>累計%</th>
          </tr>
        </thead>
        <tbody>
          {list.map(item => {
            const d = calc(item);
            return (
              <tr key={item.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ padding: '12px' }}><b>{item.symbol}</b><br/><small style={{color:'#94a3b8'}}>{item.shares.toLocaleString()}</small></td>
                <td style={{ padding: '12px' }}>{priceMode === 'unit' ? d.unitPrice.toLocaleString() : Math.round(d.mv).toLocaleString()}</td>
                <td style={{ padding: '12px', color: getColor(d.today) }}>{todayMode === 'val' ? (d.today >= 0 ? '+' : '') + Math.round(d.today).toLocaleString() : (d.todayPct >= 0 ? '+' : '') + d.todayPct.toFixed(2) + '%'}</td>
                <td style={{ padding: '12px', color: getColor(d.total), fontWeight: 'bold' }}>{d.totalPct.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SimpleSection({ title, total, items, color, isDebt }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ marginBottom: '12px' }}>
      <div onClick={() => setShow(!show)} style={{ background: '#fff', padding: '18px', borderRadius: '20px', display: 'flex', justifyContent: 'space-between', borderLeft: `6px solid ${color}`, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <b style={{ fontSize: '15px' }}>{title} {show ? '▲' : '▼'}</b>
        <b style={{ color: isDebt ? '#ef4444' : '#334155', fontSize: '16px' }}>{isDebt ? '-' : ''}{Math.round(total).toLocaleString()}</b>
      </div>
      {show && items.map(item => (
        <div key={item.id} style={{ background: '#fff', display: 'flex', justifyContent: 'space-between', padding: '12px 24px', borderTop: '1px solid #f1f5f9', fontSize: '14px' }}>
          <span>{item.name}</span>
          <b>{Math.round(item.amount).toLocaleString()}</b>
        </div>
      ))}
    </div>
  );
}

export default App;
