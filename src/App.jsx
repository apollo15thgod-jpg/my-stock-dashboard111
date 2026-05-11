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

  // 預設折疊
  const [showUS, setShowUS] = useState(false);
  const [showTW, setShowTW] = useState(false);
  const [showOther, setShowOther] = useState(false);
  const [showDebt, setShowDebt] = useState(false);

  const [todayMode, setTodayMode] = useState('val'); 
  const [priceMode, setPriceMode] = useState('unit');

  const assetsRef = useRef(assets);
  useEffect(() => { assetsRef.current = assets; }, [assets]);

  // --- 數據抓取 ---
  const fetchRateFromCloud = useCallback(async () => {
    try {
      const res = await fetch(`${CALC_CSV_URL}&t=${Date.now()}`);
      const text = await res.text();
      const rows = text.split('\n');
      if (rows.length >= 15) {
        const columns = rows[14].split(',');
        if (columns.length >= 2) {
          const rateNum = parseFloat(columns[1].replace(/[",]/g, '').trim());
          if (!isNaN(rateNum) && rateNum > 0) setExchangeRate(rateNum);
        }
      }
    } catch (e) { console.error("匯率讀取失敗", e); }
  }, [CALC_CSV_URL]);

  const refreshPrices = useCallback(async (isManual = false) => {
    if (isManual) setLoading(true);
    try {
      if (isManual) await fetchRateFromCloud();
      const csvRes = await fetch(`${PRICE_CSV_URL}&t=${Date.now()}`);
      const csvText = await csvRes.text();
      const lines = csvText.split(/\r?\n/).map(line => line.replace(/[",]/g, '').trim());

      const updated = await Promise.all(assetsRef.current.map(async (item) => {
        if (!item.symbol) return item;
        try {
          if (!/^\d/.test(item.symbol)) {
            const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${item.symbol}&token=${API_KEY}`);
            const data = await res.json();
            if (data.c) return { ...item, price: data.c, prevClose: data.pc || data.c };
          } else {
            const twIndex = assetsRef.current.filter(a => /^\d/.test(a.symbol)).indexOf(item);
            const price = parseFloat(lines[twIndex * 2]) || 0;
            const prev = parseFloat(lines[twIndex * 2 + 1]) || price;
            return { ...item, price: price || item.price, prevClose: prev || item.prevClose };
          }
        } catch (e) { return item; }
        return item;
      }));
      setAssets(prev => JSON.stringify(prev) === JSON.stringify(updated) ? prev : updated);
    } catch (e) { console.error("更新中斷", e); } finally { if (isManual) setLoading(false); }
  }, [fetchRateFromCloud, PRICE_CSV_URL, API_KEY]);

  useEffect(() => {
    const timer = setInterval(() => { if (!showAdmin) refreshPrices(false); }, 10000); 
    return () => clearInterval(timer);
  }, [refreshPrices, showAdmin]);

  useEffect(() => { refreshPrices(true); }, []);

  useEffect(() => { localStorage.setItem('myAssets', JSON.stringify(assets)); }, [assets]);
  useEffect(() => { localStorage.setItem('myOtherAssets', JSON.stringify(otherAssets)); }, [otherAssets]);
  useEffect(() => { localStorage.setItem('myLiabilities', JSON.stringify(liabilities)); }, [liabilities]);

  // --- 計算核心 ---
  const calculateAsset = (item) => {
    const isUS = !/^\d/.test(item.symbol);
    const m = isUS ? exchangeRate : 1;
    const p = item.price || 0;
    const pc = (item.prevClose && item.prevClose !== 0) ? item.prevClose : p;
    const mv = p * (item.shares || 0) * m;
    const prevMv = pc * (item.shares || 0) * m;
    const costTWD = (item.totalCost || 0) * (isUS ? exchangeRate : 1); 
    return { isUS, mv, today: mv - prevMv, todayPct: pc > 0 ? ((p - pc) / pc) * 100 : 0, total: mv - costTWD, totalPct: costTWD > 0 ? ((mv - costTWD) / costTWD) * 100 : 0, unitPrice: p };
  };

  const usAssets = assets.filter(a => !/^\d/.test(a.symbol));
  const twAssets = assets.filter(a => /^\d/.test(a.symbol));
  const totalOtherAssets = otherAssets.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  const totalDebt = liabilities.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);

  const getSum = (list) => list.reduce((acc, a) => {
    const d = calculateAsset(a);
    return { mv: acc.mv + d.mv, today: acc.today + d.today, total: acc.total + d.total, cost: acc.cost + (a.totalCost * (d.isUS ? exchangeRate : 1)) };
  }, { mv: 0, today: 0, total: 0, cost: 0 });

  const usTotal = getSum(usAssets);
  const twTotal = getSum(twAssets);
  const grandTotalMv = usTotal.mv + twTotal.mv + totalOtherAssets;

  const getValueColor = (val) => (val >= 0.01 ? '#ef4444' : val <= -0.01 ? '#22c55e' : '#64748b');

  return (
    <div style={{ padding: '12px', fontFamily: '-apple-system, sans-serif', maxWidth: '1200px', margin: '0 auto', minHeight: '100vh', backgroundImage: `linear-gradient(rgba(240, 242, 245, 0.8), rgba(240, 242, 245, 0.8)), url('https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?q=80&w=2067&auto=format&fit=crop')`, backgroundSize: 'cover', backgroundAttachment: 'fixed' }}>
      
      {/* 頂部控制列 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '12px' }}>
        <button onClick={() => refreshPrices(true)} disabled={loading} style={{ flex: 1, maxWidth: '120px', padding: '12px 0', background: 'rgba(255,255,255,0.9)', border: '1px solid #cbd5e1', borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold' }}>
          {loading ? '⚡ 更新中' : '🔄 自動更新中'}
        </button>
        <button onClick={() => setShowAdmin(!showAdmin)} style={{ flex: 1, maxWidth: '120px', padding: '12px 0', background: '#1e293b', color: '#fff', borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold' }}>⚙️ 設定</button>
      </div>

      {/* 總覽面板 */}
      <div style={{ background: 'rgba(30, 41, 59, 0.95)', color: '#fff', padding: '25px', borderRadius: '24px', marginBottom: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <div><div style={{ fontSize: '12px', opacity: 0.6 }}>總資產</div><div style={{ fontSize: '24px', fontWeight: 'bold' }}>{Math.round(grandTotalMv).toLocaleString()}</div></div>
        <div style={{ textAlign: 'right' }}><div style={{ fontSize: '12px', opacity: 0.6 }}>即時匯率</div><div style={{ fontSize: '24px', fontWeight: 'bold', color: '#fbbf24' }}>{exchangeRate.toFixed(2)}</div></div>
        <div><div style={{ fontSize: '12px', opacity: 0.6 }}>今日股票損益</div><div style={{ fontSize: '24px', fontWeight: 'bold', color: getValueColor(usTotal.today + twTotal.today) }}>{Math.round(usTotal.today + twTotal.today).toLocaleString()}</div></div>
        <div style={{ textAlign: 'right' }}><div style={{ fontSize: '12px', opacity: 0.6 }}>累積股票損益</div><div style={{ fontSize: '24px', fontWeight: 'bold', color: getValueColor(usTotal.total + twTotal.total) }}>{Math.round(usTotal.total + twTotal.total).toLocaleString()}</div></div>
      </div>

      <MobileSection title="🇺🇸 美股資產" total={usTotal} show={showUS} setShow={setShowUS}>
        <AssetTable list={usAssets} calc={calculateAsset} getValueColor={getValueColor} todayMode={todayMode} setTodayMode={setTodayMode} priceMode={priceMode} setPriceMode={setPriceMode} />
      </MobileSection>

      <MobileSection title="🇹🇼 台股資產" total={twTotal} show={showTW} setShow={setShowTW}>
        <AssetTable list={twAssets} calc={calculateAsset} getValueColor={getValueColor} todayMode={todayMode} setTodayMode={setTodayMode} priceMode={priceMode} setPriceMode={setPriceMode} />
      </MobileSection>

      <SimpleList title="🏦 存款/現金" total={totalOtherAssets} items={otherAssets} show={showOther} setShow={setShowOther} color="#3b82f6" />
      <SimpleList title="💸 負債明細" total={totalDebt} items={liabilities} show={showDebt} setShow={setShowDebt} color="#64748b" isDebt />

      {/* 設定 Modal */}
      {showAdmin && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', zIndex: 1000 }}>
          <div style={{ background: '#fff', padding: '24px', borderTopLeftRadius: '24px', borderTopRightRadius: '24px', width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}><h3>⚙️ 設定</h3><button onClick={() => setShowAdmin(false)}>✕</button></div>
            <p>請在此新增您的代號與股數...</p>
            {/* 設定表單省略，請沿用原本邏輯 */}
            <button onClick={() => setShowAdmin(false)} style={{ width: '100%', padding: '15px', background: '#1e293b', color: '#fff', borderRadius: '10px' }}>儲存並關閉</button>
          </div>
        </div>
      )}
    </div>
  );
}

function MobileSection({ title, total, show, setShow, children }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div onClick={() => setShow(!show)} style={{ background: 'rgba(255,255,255,0.85)', padding: '16px 20px', borderRadius: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', border: '1px solid #fff' }}>
        <b style={{ fontSize: '16px' }}>{title} {show ? '▲' : '▼'}</b>
        <b style={{ fontSize: '15px' }}>{Math.round(total.mv).toLocaleString()}</b>
      </div>
      {show && children}
    </div>
  );
}

// 修正後的表格組件：新增「總價」欄位
function AssetTable({ list, calc, getValueColor, todayMode, setTodayMode, priceMode, setPriceMode }) {
  return (
    <div style={{ overflowX: 'auto', background: 'rgba(255,255,255,0.95)', marginTop: '6px', borderRadius: '18px' }}>
      <table style={{ width: '100%', minWidth: '500px', borderCollapse: 'collapse', fontSize: '14px' }}>
        <thead>
          <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
            <th style={{ padding: '12px 15px' }}>代號</th>
            <th style={{ padding: '12px 15px', cursor: 'pointer' }} onClick={() => setPriceMode(priceMode === 'total' ? 'unit' : 'total')}>{priceMode === 'unit' ? '現價' : '現值'}</th>
            <th style={{ padding: '12px 15px', cursor: 'pointer' }} onClick={() => setTodayMode(todayMode === 'val' ? 'pct' : 'val')}>今日</th>
            <th style={{ padding: '12px 15px' }}>總價</th>
            <th style={{ padding: '12px 15px' }}>累積</th>
          </tr>
        </thead>
        <tbody>
          {list.map(item => {
            const d = calc(item);
            return (
              <tr key={item.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                <td style={{ padding: '12px 15px' }}><b>{item.symbol}</b><br/><small>{item.shares.toLocaleString()} 股</small></td>
                <td style={{ padding: '12px 15px' }}>{priceMode === 'unit' ? d.unitPrice.toLocaleString() : Math.round(d.mv).toLocaleString()}</td>
                <td style={{ padding: '12px 15px', color: getValueColor(d.today) }}>
                  {todayMode === 'val' ? (d.today >= 0 ? '+' : '') + Math.round(d.today).toLocaleString() : d.todayPct.toFixed(2) + '%'}
                </td>
                {/* 新增：總價欄位 */}
                <td style={{ padding: '12px 15px', fontWeight: 'bold' }}>
                  {Math.round(d.mv).toLocaleString()}
                </td>
                <td style={{ padding: '12px 15px', color: getValueColor(d.total) }}>{d.totalPct.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SimpleList({ title, total, items, show, setShow, color, isDebt }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div onClick={() => setShow(!show)} style={{ background: 'rgba(255,255,255,0.85)', padding: '16px 20px', borderRadius: '20px', display: 'flex', justifyContent: 'space-between', borderLeft: `6px solid ${color}`, cursor: 'pointer' }}>
        <b style={{ fontSize: '16px' }}>{title} {show ? '▲' : '▼'}</b>
        <b style={{ color: isDebt ? '#ef4444' : '#333' }}>{isDebt ? '-' : ''}{Math.round(total).toLocaleString()}</b>
      </div>
      {show && items.map(item => (
        <div key={item.id} style={{ background: 'rgba(255,255,255,0.95)', display: 'flex', justifyContent: 'space-between', padding: '12px 25px', borderTop: '1px solid #f0f0f0' }}>
          <span>{item.name}</span><span>{Math.round(item.amount).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export default App;
