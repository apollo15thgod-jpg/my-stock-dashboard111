import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';

function App() {
  const API_KEY = 'd7j25k9r01qp3g1rhb10d7j25k9r01qp3g1rhb1g';
  const PRICE_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?output=csv";
  const CALC_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?gid=606181682&single=true&output=csv"; 
  const HISTORY_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSU7-1HIrJ-UNAM1nj56uaYDUcpUvB6peAWTlXgiM2sUnOsEJdCJ2dg9A2zZ4c2mJP8AbwNF99Nxz-k/pub?gid=648456386&single=true&output=csv";

  const [assets, setAssets] = useState(() => JSON.parse(localStorage.getItem('myAssets')) || []);
  const [otherAssets, setOtherAssets] = useState(() => JSON.parse(localStorage.getItem('myOtherAssets')) || []);
  const [liabilities, setLiabilities] = useState(() => JSON.parse(localStorage.getItem('myLiabilities')) || []);
  const [history, setHistory] = useState([]);
  const [exchangeRate, setExchangeRate] = useState(32.0);
  const [loading, setLoading] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [todayMode, setTodayMode] = useState('val'); 

  const [openSections, setOpenSections] = useState({ us: false, tw: false, other: false, debt: false });
  const toggleSection = (key) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  const assetsRef = useRef(assets);
  useEffect(() => { assetsRef.current = assets; }, [assets]);

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

  const refreshPrices = useCallback(async (isManual = false) => {
    if (isManual) setLoading(true);
    try {
      if (isManual) { await fetchRateFromCloud(); await fetchHistoryFromCloud(); }
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
  }, [fetchRateFromCloud, fetchHistoryFromCloud, PRICE_CSV_URL, API_KEY]);

  useEffect(() => {
    refreshPrices(true);
    const timer = setInterval(() => { if (!showAdmin) refreshPrices(false); }, 10000);
    return () => clearInterval(timer);
  }, [refreshPrices, showAdmin]);

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
  
  const stats = useMemo(() => {
    const all = [...usAssets, ...twAssets].map(calculateAsset);
    const mvStock = all.reduce((s, x) => s + x.mv, 0);
    const prevMvStock = all.reduce((s, x) => s + x.prevMv, 0);
    return { mvStock, todayVal: mvStock - prevMvStock, totalAssets: mvStock + sumOther };
  }, [assets, exchangeRate, sumOther]);

  const chartData = useMemo(() => {
    if (!history || history.length < 2) return null;
    const combinedHistory = history.map(h => ({ ...h, totalVal: h.val + sumOther }));
    const vals = combinedHistory.map(d => d.totalVal);
    const minV = Math.floor(Math.min(...vals) / 10000) * 10000;
    const maxV = Math.ceil(Math.max(...vals) / 10000) * 10000;
    const vRange = (maxV - minV) || 10000;
    const yTicks = [minV, (minV + maxV) / 2, maxV];
    const points = combinedHistory.map((h, i) => {
      const x = (i / (combinedHistory.length - 1)) * 100;
      const y = 100 - ((h.totalVal - minV) / vRange) * 100;
      return `${x},${y}`;
    }).join(' ');
    return { points, yTicks, minV, maxV, vRange };
  }, [history, sumOther]);

  const getValColor = (v) => v > 0 ? '#ff3b30' : v < 0 ? '#34c759' : '#8e8e93';

  return (
    <div style={{ minHeight: '100vh', padding: 'env(safe-area-inset-top) 16px env(safe-area-inset-bottom) 16px', background: '#f2f2f7', fontFamily: '-apple-system, system-ui, sans-serif' }}>
      
      {/* 頂部按鈕 */}
      <div style={{ display: 'flex', gap: '8px', padding: '12px 0' }}>
        <button onClick={() => refreshPrices(true)} style={{ flex: 1, height: '44px', background: '#fff', border: 'none', borderRadius: '12px', fontWeight: 'bold' }}>
          {loading ? '更新中' : '🔄 重新整理'}
        </button>
        <button onClick={() => setShowAdmin(true)} style={{ width: '44px', height: '44px', background: '#fff', border: 'none', borderRadius: '12px' }}>⚙️</button>
      </div>

      {/* 總覽卡片 */}
      <div style={{ background: '#1c1c1e', color: '#fff', borderRadius: '24px', padding: '24px', marginBottom: '12px' }}>
        <div style={{ fontSize: '12px', opacity: 0.5 }}>總資產 (股票+存款)</div>
        <div style={{ fontSize: '28px', fontWeight: 'bold', margin: '4px 0 16px 0' }}>{Math.round(stats.totalAssets).toLocaleString()}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', borderTop: '1px solid #333', paddingTop: '12px' }}>
          <div onClick={() => setTodayMode(todayMode === 'val' ? 'pct' : 'val')}>
            <div style={{ fontSize: '10px', opacity: 0.5 }}>今日損益 {todayMode === 'val' ? '(金)' : '(%)'}</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: getValColor(stats.todayVal) }}>
              {Math.round(stats.todayVal).toLocaleString()}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '10px', opacity: 0.5 }}>匯率</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#ffd60a' }}>{exchangeRate.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {/* 趨勢圖 - 已補回左側欄位 */}
      <div style={{ background: '#fff', borderRadius: '20px', padding: '20px 16px 20px 8px', marginBottom: '12px', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
        <div style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '15px', paddingLeft: '12px' }}>📊 資產趨勢</div>
        <div style={{ height: '150px', width: '100%', position: 'relative', display: 'flex' }}>
          {/* Y 軸座標欄位 */}
          <div style={{ width: '45px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end', paddingRight: '8px', fontSize: '10px', color: '#8e8e93' }}>
            {chartData && chartData.yTicks.reverse().map((tick, i) => (
              <span key={i}>{Math.round(tick/10000)}萬</span>
            ))}
          </div>
          {/* 圖表主體 */}
          <div style={{ flex: 1, position: 'relative' }}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
              {chartData && (
                <>
                  {chartData.yTicks.map((tick, i) => {
                    const y = 100 - ((tick - chartData.minV) / chartData.vRange) * 100;
                    return <line key={i} x1="0" y1={y} x2="100" y2={y} stroke="#f2f2f7" strokeWidth="1" />;
                  })}
                  <polyline points={chartData.points} fill="none" stroke="#007aff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </>
              )}
            </svg>
          </div>
        </div>
      </div>

      {/* 下方資產區塊與之前邏輯一致 */}
      <MobileSection title="🇺🇸 美股資產" total={usAssets.reduce((s,a)=>s+calculateAsset(a).mv, 0)} isOpen={openSections.us} onToggle={() => toggleSection('us')}>
        <AssetTable list={usAssets} calc={calculateAsset} getColor={getValColor} todayMode={todayMode} setTodayMode={setTodayMode} />
      </MobileSection>

      <MobileSection title="🇹🇼 台股資產" total={twAssets.reduce((s,a)=>s+calculateAsset(a).mv, 0)} isOpen={openSections.tw} onToggle={() => toggleSection('tw')}>
        <AssetTable list={twAssets} calc={calculateAsset} getColor={getValColor} todayMode={todayMode} setTodayMode={setTodayMode} />
      </MobileSection>
    </div>
  );
}

// 支援橫滑的 AssetTable
function AssetTable({ list, calc, getColor, todayMode, setTodayMode }) {
  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', margin: '0 -12px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '420px' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: '#8e8e93', borderBottom: '1px solid #f2f2f7' }}>
            <th style={{ padding: '8px 12px', position: 'sticky', left: 0, background: '#fff', zIndex: 5 }}>代號</th>
            <th style={{ padding: '8px 12px' }}>現價</th>
            <th style={{ padding: '8px 12px', color: '#007aff' }} onClick={(e) => { e.stopPropagation(); setTodayMode(todayMode === 'val' ? 'pct' : 'val'); }}>今日</th>
            <th style={{ padding: '8px 12px' }}>總價(台)</th>
            <th style={{ padding: '8px 12px' }}>累積</th>
          </tr>
        </thead>
        <tbody>
          {list.map(item => {
            const d = calc(item);
            return (
              <tr key={item.id} style={{ borderBottom: '1px solid #f2f2f7' }}>
                <td style={{ padding: '12px 12px', position: 'sticky', left: 0, background: '#fff', fontWeight: 'bold' }}>
                  {item.symbol}<br/><span style={{ fontSize: '10px', fontWeight: 'normal', opacity: 0.4 }}>{item.shares}股</span>
                </td>
                <td style={{ padding: '12px 12px' }}>{d.unitPrice.toLocaleString()}</td>
                <td style={{ padding: '12px 12px', color: getColor(d.today), fontWeight: 'bold' }}>
                  {todayMode === 'val' ? Math.round(d.today).toLocaleString() : d.todayPct.toFixed(2) + '%'}
                </td>
                <td style={{ padding: '12px 12px', fontWeight: '600' }}>{Math.round(d.mv).toLocaleString()}</td>
                <td style={{ padding: '12px 12px', color: getColor(d.total) }}>{d.totalPct.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MobileSection({ title, total, isOpen, onToggle, children }) {
  return (
    <div style={{ background: '#fff', borderRadius: '18px', marginBottom: '8px', padding: '16px', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
      <div onClick={onToggle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 'bold' }}>{title}</span>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 'bold' }}>{Math.round(total).toLocaleString()}</div>
          <div style={{ fontSize: '10px', opacity: 0.3 }}>{isOpen ? '收起 ▲' : '展開 ▼'}</div>
        </div>
      </div>
      {isOpen && <div style={{ marginTop: '12px', borderTop: '1px solid #f2f2f7', paddingTop: '8px' }}>{children}</div>}
    </div>
  );
}

export default App;
