import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';

function App() {
  const API_KEY = 'd7j25k9r01qp3g1rhb10d7j25k9r01qp3g1rhb1g';
  const PRICE_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?output=csv";
  const CALC_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?gid=606181682&single=true&output=csv"; 

  // --- 狀態管理 ---
  const [assets, setAssets] = useState(() => JSON.parse(localStorage.getItem('myAssets')) || []);
  const [otherAssets, setOtherAssets] = useState(() => JSON.parse(localStorage.getItem('myOtherAssets')) || []);
  const [liabilities, setLiabilities] = useState(() => JSON.parse(localStorage.getItem('myLiabilities')) || []);
  const [exchangeRate, setExchangeRate] = useState(32.0);
  const [loading, setLoading] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);

  // 切換模式：今日損益 (金額/百分比)
  const [todayMode, setTodayMode] = useState('val'); 

  // 預設全部收合
  const [openSections, setOpenSections] = useState({ us: false, tw: false, other: false, debt: false });
  const toggleSection = (key) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

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
          if (!isNaN(rateNum)) setExchangeRate(rateNum);
        }
      }
    } catch (e) { console.error("匯率失敗"); }
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
            return { ...item, price, prevClose: prev };
          }
        } catch (e) { return item; }
        return item;
      }));
      setAssets(updated);
    } catch (e) { console.error("更新失敗"); } finally { if (isManual) setLoading(false); }
  }, [fetchRateFromCloud, PRICE_CSV_URL, API_KEY]);

  useEffect(() => {
    refreshPrices(true);
    const timer = setInterval(() => { if (!showAdmin) refreshPrices(false); }, 10000);
    return () => clearInterval(timer);
  }, [refreshPrices, showAdmin]);

  useEffect(() => { localStorage.setItem('myAssets', JSON.stringify(assets)); }, [assets]);
  useEffect(() => { localStorage.setItem('myOtherAssets', JSON.stringify(otherAssets)); }, [otherAssets]);
  useEffect(() => { localStorage.setItem('myLiabilities', JSON.stringify(liabilities)); }, [liabilities]);

  // --- 計算邏輯 ---
  const calculateAsset = (item) => {
    const isUS = !/^\d/.test(item.symbol);
    const m = isUS ? exchangeRate : 1;
    const p = item.price || 0;
    const pc = item.prevClose || p;
    const mv = p * (item.shares || 0) * m;
    const prevMv = pc * (item.shares || 0) * m;
    const costTWD = (item.totalCost || 0) * (isUS ? exchangeRate : 1);
    return { isUS, mv, today: mv - prevMv, todayPct: pc > 0 ? ((p - pc) / pc) * 100 : 0, total: mv - costTWD, totalPct: costTWD > 0 ? ((mv - costTWD) / costTWD) * 100 : 0, unitPrice: p, prevMv };
  };

  const usAssets = assets.filter(a => !/^\d/.test(a.symbol));
  const twAssets = assets.filter(a => /^\d/.test(a.symbol));
  const sumOther = otherAssets.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
  const sumDebt = liabilities.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);

  const stats = useMemo(() => {
    const all = [...usAssets, ...twAssets].map(calculateAsset);
    const mvStock = all.reduce((s, x) => s + x.mv, 0);
    const prevMvStock = all.reduce((s, x) => s + x.prevMv, 0);
    const todayVal = mvStock - prevMvStock;
    const todayPct = prevMvStock > 0 ? (todayVal / prevMvStock) * 100 : 0;
    return { mvStock, todayVal, todayPct, totalAssets: mvStock + sumOther };
  }, [assets, exchangeRate, sumOther]);

  const getValColor = (v) => v > 0 ? '#ff3b30' : v < 0 ? '#34c759' : '#8e8e93';

  return (
    <div style={{ minHeight: '100vh', padding: 'env(safe-area-inset-top) 16px env(safe-area-inset-bottom) 16px', background: '#f2f2f7', fontFamily: '-apple-system, system-ui, sans-serif' }}>
      
      {/* 頂部按鈕 */}
      <div style={{ display: 'flex', gap: '8px', padding: '12px 0' }}>
        <button onClick={() => refreshPrices(true)} style={{ flex: 1, height: '44px', background: '#fff', border: 'none', borderRadius: '12px', fontWeight: 'bold', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          {loading ? '更新中...' : '🔄 重新整理'}
        </button>
        <button onClick={() => setShowAdmin(true)} style={{ width: '44px', height: '44px', background: '#fff', border: 'none', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>⚙️</button>
      </div>

      {/* 總覽卡片：點擊今日損益區域可切換 % */}
      <div style={{ background: '#1c1c1e', color: '#fff', borderRadius: '24px', padding: '24px', marginBottom: '16px', boxShadow: '0 10px 20px rgba(0,0,0,0.15)' }}>
        <div style={{ fontSize: '13px', opacity: 0.5, marginBottom: '4px' }}>總資產 (股票+存款)</div>
        <div style={{ fontSize: '32px', fontWeight: '800', marginBottom: '20px' }}>{Math.round(stats.totalAssets).toLocaleString()}</div>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', borderTop: '1px solid #333', paddingTop: '16px' }}>
          <div onClick={() => setTodayMode(todayMode === 'val' ? 'pct' : 'val')} style={{ cursor: 'pointer' }}>
            <div style={{ fontSize: '11px', opacity: 0.5, marginBottom: '2px' }}>今日損益 {todayMode === 'val' ? '(金)' : '(%)'} 👆</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: getValColor(stats.todayVal) }}>
              {todayMode === 'val' ? (stats.todayVal >= 0 ? '+' : '') + Math.round(stats.todayVal).toLocaleString() : (stats.todayPct >= 0 ? '+' : '') + stats.todayPct.toFixed(2) + '%'}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '11px', opacity: 0.5, marginBottom: '2px' }}>美金匯率</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#ffd60a' }}>{exchangeRate.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {/* 股票區塊 */}
      <MobileSection title="🇺🇸 美股資產" total={usAssets.reduce((s,a)=>s+calculateAsset(a).mv, 0)} isOpen={openSections.us} onToggle={() => toggleSection('us')}>
        <AssetTable list={usAssets} calc={calculateAsset} getColor={getValColor} todayMode={todayMode} setTodayMode={setTodayMode} />
      </MobileSection>

      <MobileSection title="🇹🇼 台股資產" total={twAssets.reduce((s,a)=>s+calculateAsset(a).mv, 0)} isOpen={openSections.tw} onToggle={() => toggleSection('tw')}>
        <AssetTable list={twAssets} calc={calculateAsset} getColor={getValColor} todayMode={todayMode} setTodayMode={setTodayMode} />
      </MobileSection>

      {/* 存款與負債項目同前 ... */}
      <MobileSection title="🏦 存款/現金" total={sumOther} isOpen={openSections.other} onToggle={() => toggleSection('other')}>
        {otherAssets.map(a => <SimpleRow key={a.id} name={a.name} amount={a.amount} />)}
      </MobileSection>

      <MobileSection title="💸 負債" total={sumDebt} isOpen={openSections.debt} onToggle={() => toggleSection('debt')} isDebt>
        {liabilities.map(a => <SimpleRow key={a.id} name={a.name} amount={a.amount} isDebt />)}
      </MobileSection>

      {/* 設定彈窗省略 ... (與之前相同) */}
    </div>
  );
}

// 內部表格組件
function AssetTable({ list, calc, getColor, todayMode, setTodayMode }) {
  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', margin: '0 -12px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', minWidth: '420px' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: '#8e8e93', borderBottom: '1px solid #f2f2f7' }}>
            <th style={{ padding: '10px 12px', position: 'sticky', left: 0, background: '#fff', zIndex: 5 }}>代號</th>
            <th style={{ padding: '10px 12px' }}>現價</th>
            <th 
              style={{ padding: '10px 12px', color: '#007aff', fontWeight: 'bold' }} 
              onClick={(e) => { e.stopPropagation(); setTodayMode(todayMode === 'val' ? 'pct' : 'val'); }}
            >
              今日 {todayMode === 'val' ? '(💸)' : '(%)'}
            </th>
            <th style={{ padding: '10px 12px' }}>總價(TWD)</th>
            <th style={{ padding: '10px 12px' }}>累積</th>
          </tr>
        </thead>
        <tbody>
          {list.map(item => {
            const d = calc(item);
            return (
              <tr key={item.id} style={{ borderBottom: '1px solid #f2f2f7' }}>
                <td style={{ padding: '14px 12px', position: 'sticky', left: 0, background: '#fff', fontWeight: '700' }}>
                  {item.symbol}<br/><span style={{ fontSize: '10px', fontWeight: '400', opacity: 0.4 }}>{item.shares}股</span>
                </td>
                <td style={{ padding: '14px 12px' }}>{d.unitPrice.toLocaleString()}</td>
                <td style={{ padding: '14px 12px', color: getColor(d.today), fontWeight: '600' }}>
                  {todayMode === 'val' ? (d.today >= 0 ? '+' : '') + Math.round(d.today).toLocaleString() : (d.todayPct >= 0 ? '+' : '') + d.todayPct.toFixed(2) + '%'}
                </td>
                <td style={{ padding: '14px 12px', fontWeight: 'bold' }}>{Math.round(d.mv).toLocaleString()}</td>
                <td style={{ padding: '14px 12px', color: getColor(d.total), fontWeight: '600' }}>{d.totalPct.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MobileSection({ title, total, isOpen, onToggle, children, isDebt }) {
  return (
    <div style={{ background: '#fff', borderRadius: '18px', marginBottom: '10px', padding: '16px', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
      <div onClick={onToggle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: '800', fontSize: '17px' }}>{title}</span>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: '800', fontSize: '16px', color: isDebt ? '#ff3b30' : '#000' }}>{isDebt ? '-' : ''}{Math.round(total).toLocaleString()}</div>
          <div style={{ fontSize: '11px', color: '#007aff', fontWeight: 'bold' }}>{isOpen ? '收起 ▲' : '詳情 ▼'}</div>
        </div>
      </div>
      {isOpen && <div style={{ marginTop: '16px', borderTop: '1px solid #f2f2f7' }}>{children}</div>}
    </div>
  );
}

function SimpleRow({ name, amount, isDebt }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f9f9f9', fontSize: '15px' }}>
      <span>{name}</span>
      <span style={{ fontWeight: '600', color: isDebt ? '#ff3b30' : '#000' }}>{Math.round(amount).toLocaleString()}</span>
    </div>
  );
}

export default App;
