import React, { useState, useEffect, useCallback, useMemo } from 'react';

function App() {
  const API_KEY = 'd7j25k9r01qp3g1rhb10d7j25k9r01qp3g1rhb1g';
  const PRICE_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?output=csv";
  const HISTORY_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?gid=648456386&single=true&output=csv"; 
  const CALC_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?gid=606181682&single=true&output=csv"; 

  // --- 狀態管理 (確保初始值正確) ---
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

  // --- 抓取雲端匯率 ---
  const fetchRateFromCloud = useCallback(async () => {
    try {
      const res = await fetch(`${CALC_CSV_URL}&t=${Date.now()}`);
      const text = await res.text();
      const matches = text.match(/\d{2}\.\d+/g) || [];
      if (matches.length > 0) setExchangeRate(Number(matches[0]));
    } catch (e) { console.error("匯率抓取失敗", e); }
  }, [CALC_CSV_URL]);

  // --- 抓取雲端歷史軌跡 ---
  const fetchHistoryFromCloud = useCallback(async () => {
    try {
      const res = await fetch(`${HISTORY_CSV_URL}&t=${Date.now()}`);
      const text = await res.text();
      const rows = text.split('\n').slice(1); 
      const cloudHistory = rows.map(row => {
        const cols = row.split(',');
        if (cols.length < 2) return null;
        return { ts: new Date(cols[0]).getTime(), val: parseFloat(cols[1]?.replace(/[^0-9.]/g, '')) };
      }).filter(item => item && !isNaN(item.val));
      setHistory(cloudHistory.sort((a,b) => a.ts - b.ts));
    } catch (e) { console.error("歷史抓取失敗", e); }
  }, [HISTORY_CSV_URL]);

  // --- 刷新價格 (修正台股抓取 A1/B1) ---
  const refreshPrices = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await fetchRateFromCloud();
      const csvRes = await fetch(`${PRICE_CSV_URL}&t=${Date.now()}`);
      const csvText = await csvRes.text();
      const rows = csvText.split('\n').map(r => r.split(','));
      
      // 定義：A1=現價 (0,0), B1=昨收 (0,1)
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
            // 台股抓取 CSV 的 A1, B1
            return { ...item, price: twCurrentPrice, prevClose: twPrevClose };
          }
        } catch (e) { console.error(e); }
        return item;
      }));
      setAssets(updated);
      await fetchHistoryFromCloud();
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [assets, loading, fetchRateFromCloud, fetchHistoryFromCloud, PRICE_CSV_URL, API_KEY]);

  // --- 定時更新 ---
  useEffect(() => {
    const timer = setInterval(() => refreshPrices(), 60000);
    return () => clearInterval(timer);
  }, [refreshPrices]);

  // --- 存檔與初始化 ---
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
    
    return { 
      isUS, mv, 
      today: mv - prevMv, 
      todayPct: prevMv > 0 ? ((mv - prevMv) / prevMv) * 100 : 0, 
      total: mv - costTWD, 
      totalPct: costTWD > 0 ? ((mv - costTWD) / costTWD) * 100 : 0, 
      unitPrice: price 
    };
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
    const points = combinedHistory.map((h, i) => {
      const x = (i / (combinedHistory.length - 1)) * 100;
      const y = 100 - ((h.totalVal - minV) / vRange) * 100;
      return `${x},${y}`;
    }).join(' ');
    return { points, minV, maxV, vRange };
  }, [history, totalOtherAssets]);

  const getValueColor = (val) => (val >= 0.1 ? '#ef4444' : val <= -0.1 ? '#22c55e' : '#64748b');

  return (
    <div style={{ padding: '12px', maxWidth: '800px', margin: '0 auto', background: '#f8fafc', minHeight: '100vh', fontFamily: 'system-ui' }}>
      
      {/* 總覽顯示 */}
      <div style={{ background: '#1e293b', color: '#fff', padding: '20px', borderRadius: '20px', marginBottom: '15px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
        <div>
          <div style={{ fontSize: '12px', opacity: 0.7 }}>總資產 (含存款-負債)</div>
          <div style={{ fontSize: '22px', fontWeight: 'bold' }}>{Math.round(grandTotal.mv - totalDebt).toLocaleString()}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '12px', opacity: 0.7 }}>匯率 (USD)</div>
          <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#fbbf24' }}>{exchangeRate.toFixed(2)}</div>
        </div>
        <div>
          <div style={{ fontSize: '12px', opacity: 0.7 }}>今日股票損益</div>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: getValueColor(grandTotal.today) }}>
            {grandTotal.today >= 0 ? '+' : ''}{Math.round(grandTotal.today).toLocaleString()}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '12px', opacity: 0.7 }}>回報率</div>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: getValueColor(grandTotal.total) }}>{grandTotal.percent.toFixed(2)}%</div>
        </div>
      </div>

      {/* 趨勢圖 */}
      <div style={{ background: '#fff', padding: '15px', borderRadius: '20px', marginBottom: '15px', border: '1px solid #e2e8f0' }}>
        <b>📊 資產走勢</b>
        <div style={{ height: '120px', width: '100%', position: 'relative', marginTop: '10px' }}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
            {chartData && <polyline points={chartData.points} fill="none" stroke="#3b82f6" strokeWidth="2" />}
          </svg>
        </div>
      </div>

      {/* 資產清單 */}
      <MobileSection title="🇺🇸 美股" total={usTotal} show={showUS} setShow={setShowUS}>
        <AssetTable list={usAssets} calc={calculateAsset} getValColor={getValueColor} todayMode={todayMode} setTodayMode={setTodayMode} priceMode={priceMode} setPriceMode={setPriceMode} />
      </MobileSection>

      <MobileSection title="🇹🇼 台股" total={twTotal} show={showTW} setShow={setShowTW}>
        <AssetTable list={twAssets} calc={calculateAsset} getValColor={getValueColor} todayMode={todayMode} setTodayMode={setTodayMode} priceMode={priceMode} setPriceMode={setPriceMode} />
      </MobileSection>

      <div style={{ marginBottom: '12px' }}>
        <div onClick={() => setShowOther(!showOther)} style={{ background: '#fff', padding: '15px 20px', borderRadius: '15px', display: 'flex', justifyContent: 'space-between', borderLeft: '6px solid #3b82f6' }}>
          <b>🏦 銀行存款 {showOther ? '▲' : '▼'}</b>
          <b>{Math.round(totalOtherAssets).toLocaleString()}</b>
        </div>
        {showOther && otherAssets.map(item => (
          <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 20px', background: '#fff', borderTop: '1px solid #f1f5f9' }}>
            <span>{item.name}</span><span>{Math.round(item.amount).toLocaleString()}</span>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div onClick={() => setShowDebt(!showDebt)} style={{ background: '#fff', padding: '15px 20px', borderRadius: '15px', display: 'flex', justifyContent: 'space-between', borderLeft: '6px solid #94a3b8' }}>
          <b>💸 負債明細 {showDebt ? '▲' : '▼'}</b>
          <b style={{ color: '#ef4444' }}>-{Math.round(totalDebt).toLocaleString()}</b>
        </div>
        {showDebt && liabilities.map(item => (
          <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 20px', background: '#fff', borderTop: '1px solid #f1f5f9' }}>
            <span>{item.name}</span><span style={{ color: '#ef4444' }}>-{Math.round(item.amount).toLocaleString()}</span>
          </div>
        ))}
      </div>

      <button onClick={() => setShowAdmin(true)} style={{ width: '100%', padding: '15px', borderRadius: '12px', background: '#1e293b', color: '#fff', border: 'none', fontWeight: 'bold' }}>⚙️ 管理資產配置</button>

      {/* 管理 Modal */}
      {showAdmin && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '15px' }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: '500px', borderRadius: '20px', padding: '20px', maxHeight: '80vh', overflowY: 'auto' }}>
            <h3>⚙️ 資產配置</h3>
            
            <p>📈 股票 (代號/股數/成本)</p>
            {assets.map(item => (
              <div key={item.id} style={{ display: 'flex', gap: '5px', marginBottom: '5px' }}>
                <input style={{ flex: 1 }} value={item.symbol} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, symbol: e.target.value.toUpperCase()} : a))} />
                <input style={{ flex: 1 }} type="number" value={item.shares} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, shares: parseFloat(e.target.value)} : a))} />
                <input style={{ flex: 1 }} type="number" value={item.totalCost} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, totalCost: parseFloat(e.target.value)} : a))} />
                <button onClick={() => setAssets(assets.filter(a => a.id !== item.id))}>✕</button>
              </div>
            ))}
            <button onClick={() => setAssets([...assets, { id: Date.now(), symbol: '', shares: 0, totalCost: 0 }])} style={{ width: '100%', marginBottom: '10px' }}>+ 新增股票</button>

            <p>🏦 存款 (名稱/金額)</p>
            {otherAssets.map(item => (
              <div key={item.id} style={{ display: 'flex', gap: '5px', marginBottom: '5px' }}>
                <input style={{ flex: 2 }} value={item.name} onChange={e => setOtherAssets(otherAssets.map(o => o.id === item.id ? {...o, name: e.target.value} : o))} />
                <input style={{ flex: 1 }} type="number" value={item.amount} onChange={e => setOtherAssets(otherAssets.map(o => o.id === item.id ? {...o, amount: parseFloat(e.target.value)} : o))} />
                <button onClick={() => setOtherAssets(otherAssets.filter(o => o.id !== item.id))}>✕</button>
              </div>
            ))}
            <button onClick={() => setOtherAssets([...otherAssets, { id: Date.now(), name: '', amount: 0 }])} style={{ width: '100%', marginBottom: '10px' }}>+ 新增存款</button>

            <p>💸 負債 (名稱/金額)</p>
            {liabilities.map(item => (
              <div key={item.id} style={{ display: 'flex', gap: '5px', marginBottom: '5px' }}>
                <input style={{ flex: 2 }} value={item.name} onChange={e => setLiabilities(liabilities.map(l => l.id === item.id ? {...l, name: e.target.value} : l))} />
                <input style={{ flex: 1 }} type="number" value={item.amount} onChange={e => setLiabilities(liabilities.map(l => l.id === item.id ? {...l, amount: parseFloat(e.target.value)} : l))} />
                <button onClick={() => setLiabilities(liabilities.filter(l => l.id !== item.id))}>✕</button>
              </div>
            ))}
            <button onClick={() => setLiabilities([...liabilities, { id: Date.now(), name: '', amount: 0 }])} style={{ width: '100%', marginBottom: '20px' }}>+ 新增負債</button>

            <button onClick={() => {setShowAdmin(false); refreshPrices();}} style={{ width: '100%', padding: '15px', background: '#3b82f6', color: '#fff', borderRadius: '12px' }}>儲存並關閉</button>
          </div>
        </div>
      )}
    </div>
  );
}

function MobileSection({ title, total, show, setShow, children }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div onClick={() => setShow(!show)} style={{ background: '#fff', padding: '15px 20px', borderRadius: '18px', display: 'flex', justifyContent: 'space-between', border: '1px solid #e2e8f0' }}>
        <b>{title} {show ? '▲' : '▼'}</b>
        <div style={{ textAlign: 'right' }}>
          <div>{Math.round(total.mv).toLocaleString()}</div>
          <div style={{ fontSize: '11px', color: total.today >= 0 ? '#ef4444' : '#22c55e' }}>{total.today >= 0 ? '+' : ''}{Math.round(total.today).toLocaleString()}</div>
        </div>
      </div>
      {show && children}
    </div>
  );
}

function AssetTable({ list, calc, getValColor, todayMode, setTodayMode, priceMode, setPriceMode }) {
  return (
    <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', marginTop: '5px' }}>
      <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f8fafc', color: '#64748b' }}>
            <th style={{ padding: '10px' }}>代號</th>
            <th style={{ padding: '10px' }}>現價/現值</th>
            <th style={{ padding: '10px' }}>今日</th>
            <th style={{ padding: '12px' }}>總損益</th>
          </tr>
        </thead>
        <tbody>
          {list.map(item => {
            const d = calc(item);
            return (
              <tr key={item.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px' }}><b>{item.symbol}</b></td>
                <td style={{ padding: '10px' }}>{Math.round(d.mv).toLocaleString()}</td>
                <td style={{ padding: '10px', color: getValColor(d.today) }}>{Math.round(d.today).toLocaleString()}</td>
                <td style={{ padding: '10px', color: getValColor(d.total) }}>{d.totalPct.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default App;
