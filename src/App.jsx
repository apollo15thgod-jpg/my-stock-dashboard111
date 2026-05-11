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

  useEffect(() => { localStorage.setItem('myAssets', JSON.stringify(assets)); }, [assets]);
  useEffect(() => { localStorage.setItem('myOtherAssets', JSON.stringify(otherAssets)); }, [otherAssets]);
  useEffect(() => { localStorage.setItem('myLiabilities', JSON.stringify(liabilities)); }, [liabilities]);

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
    <div style={{ minHeight: '100vh', padding: 'env(safe-area-inset-top) 16px 40px 16px', background: '#f2f2f7', fontFamily: '-apple-system, system-ui, sans-serif' }}>
      
      {/* 頂部按鈕 */}
      <div style={{ display: 'flex', gap: '8px', padding: '12px 0' }}>
        <button onClick={() => refreshPrices(true)} style={{ flex: 1, height: '44px', background: '#fff', border: 'none', borderRadius: '12px', fontWeight: 'bold', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          {loading ? '更新中' : '🔄 重新整理'}
        </button>
        <button onClick={() => setShowAdmin(true)} style={{ width: '44px', height: '44px', background: '#fff', border: 'none', borderRadius: '12px' }}>⚙️</button>
      </div>

      {/* 總覽卡片 */}
      <div style={{ background: '#1c1c1e', color: '#fff', borderRadius: '24px', padding: '24px', marginBottom: '12px' }}>
        <div style={{ fontSize: '28px', opacity: 0.5 }}>總資產 </div>
        <div style={{ fontSize: '28px', fontWeight: 'bold', margin: '4px 0 16px 0' }}>{Math.round(stats.totalAssets).toLocaleString()}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', borderTop: '1px solid #333', paddingTop: '12px' }}>
          <div onClick={() => setTodayMode(todayMode === 'val' ? 'pct' : 'val')}>
            <div style={{ fontSize: '15px', opacity: 0.5 }}>今日損益 {todayMode === 'val' ? '  ' : '(%)'}</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: getValColor(stats.todayVal) }}>
              {Math.round(stats.todayVal).toLocaleString()}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '15px', opacity: 0.5 }}>匯率</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#ffd60a' }}>{exchangeRate.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {/* 趨勢圖 */}
      <div style={{ background: '#fff', borderRadius: '20px', padding: '20px 16px 20px 8px', marginBottom: '12px', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
        <div style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '15px', paddingLeft: '12px' }}>📊 資產趨勢</div>
        <div style={{ height: '150px', width: '100%', position: 'relative', display: 'flex' }}>
          <div style={{ width: '45px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-end', paddingRight: '8px', fontSize: '10px', color: '#8e8e93' }}>
            {chartData && [...chartData.yTicks].reverse().map((tick, i) => (
              <span key={i}>{Math.round(tick/10000)}萬</span>
            ))}
          </div>
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

      {/* 美股區塊 */}
      <MobileSection title="🇺🇸 美股資產" total={usAssets.reduce((s,a)=>s+calculateAsset(a).mv, 0)} isOpen={openSections.us} onToggle={() => toggleSection('us')}>
        <AssetTable list={usAssets} calc={calculateAsset} getColor={getValColor} todayMode={todayMode} setTodayMode={setTodayMode} />
      </MobileSection>

      {/* 台股區塊 */}
      <MobileSection title="🇹🇼 台股資產" total={twAssets.reduce((s,a)=>s+calculateAsset(a).mv, 0)} isOpen={openSections.tw} onToggle={() => toggleSection('tw')}>
        <AssetTable list={twAssets} calc={calculateAsset} getColor={getValColor} todayMode={todayMode} setTodayMode={setTodayMode} />
      </MobileSection>

      {/* 存款區塊 (補回) */}
      <MobileSection title="🏦 存款/現金" total={sumOther} isOpen={openSections.other} onToggle={() => toggleSection('other')}>
        {otherAssets.length > 0 ? otherAssets.map(a => (
          <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f2f2f7', fontSize: '15px' }}>
            <span>{a.name}</span>
            <span style={{ fontWeight: '600' }}>{Math.round(a.amount).toLocaleString()}</span>
          </div>
        )) : <div style={{ padding: '10px', opacity: 0.5, textAlign: 'center' }}>尚無資料</div>}
      </MobileSection>

      {/* 負債區塊 (補回) */}
      <MobileSection title="💸 負債項目" total={sumDebt} isOpen={openSections.debt} onToggle={() => toggleSection('debt')} isDebt>
        {liabilities.length > 0 ? liabilities.map(a => (
          <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f2f2f7', fontSize: '15px' }}>
            <span>{a.name}</span>
            <span style={{ fontWeight: '600', color: '#ff3b30' }}>-{Math.round(a.amount).toLocaleString()}</span>
          </div>
        )) : <div style={{ padding: '10px', opacity: 0.5, textAlign: 'center' }}>目前無負債</div>}
      </MobileSection>

      {/* 設定 Modal */}
      {showAdmin && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', backdropFilter: 'blur(10px)' }}>
          <div style={{ background: '#fff', width: '100%', borderTopLeftRadius: '24px', borderTopRightRadius: '24px', padding: '24px', maxHeight: '85vh', overflowY: 'auto', paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <b style={{ fontSize: '18px' }}>⚙️ 資產配置設定</b>
              <button onClick={() => setShowAdmin(false)} style={{ padding: '8px' }}>✕</button>
            </div>
            
            {/* 設定表單保持原本邏輯，確保你可以新增刪除 */}
            <div style={{ marginBottom: '20px' }}>
              <p style={{ fontWeight: 'bold', color: '#007aff' }}>📈 股票資產</p>
              {assets.map(item => (
                <div key={item.id} style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                  <input style={{ flex: 1.2, padding: '10px', border: '1px solid #ddd', borderRadius: '8px' }} value={item.symbol} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, symbol: e.target.value.toUpperCase()} : a))} placeholder="代號" />
                  <input style={{ flex: 1, padding: '10px', border: '1px solid #ddd', borderRadius: '8px' }} type="number" value={item.shares} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, shares: parseFloat(e.target.value)} : a))} placeholder="股數" />
                  <input style={{ flex: 1.5, padding: '10px', border: '1px solid #ddd', borderRadius: '8px' }} type="number" value={item.totalCost} onChange={e => setAssets(assets.map(a => a.id === item.id ? {...a, totalCost: parseFloat(e.target.value)} : a))} placeholder="總成本" />
                  <button onClick={() => setAssets(assets.filter(a => a.id !== item.id))}>✕</button>
                </div>
              ))}
              <button onClick={() => setAssets([...assets, { id: Date.now(), symbol: '', shares: 0, totalCost: 0 }])} style={{ width: '100%', padding: '10px', background: '#f2f2f7', border: 'none', borderRadius: '8px' }}>+ 新增股票</button>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <p style={{ fontWeight: 'bold', color: '#34c759' }}>🏦 存款項目</p>
              {otherAssets.map(item => (
                <div key={item.id} style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                  <input style={{ flex: 2, padding: '10px', border: '1px solid #ddd', borderRadius: '8px' }} value={item.name} onChange={e => setOtherAssets(otherAssets.map(o => o.id === item.id ? {...o, name: e.target.value} : o))} placeholder="名稱" />
                  <input style={{ flex: 1, padding: '10px', border: '1px solid #ddd', borderRadius: '8px' }} type="number" value={item.amount} onChange={e => setOtherAssets(otherAssets.map(o => o.id === item.id ? {...o, amount: parseFloat(e.target.value)} : o))} placeholder="金額" />
                  <button onClick={() => setOtherAssets(otherAssets.filter(o => o.id !== item.id))}>✕</button>
                </div>
              ))}
              <button onClick={() => setOtherAssets([...otherAssets, { id: Date.now(), name: '', amount: 0 }])} style={{ width: '100%', padding: '10px', background: '#f2f2f7', border: 'none', borderRadius: '8px' }}>+ 新增存款</button>
            </div>

            <div style={{ marginBottom: '30px' }}>
              <p style={{ fontWeight: 'bold', color: '#ff3b30' }}>💸 負債項目</p>
              {liabilities.map(item => (
                <div key={item.id} style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                  <input style={{ flex: 2, padding: '10px', border: '1px solid #ddd', borderRadius: '8px' }} value={item.name} onChange={e => setLiabilities(liabilities.map(l => l.id === item.id ? {...l, name: e.target.value} : l))} placeholder="名稱" />
                  <input style={{ flex: 1, padding: '10px', border: '1px solid #ddd', borderRadius: '8px' }} type="number" value={item.amount} onChange={e => setLiabilities(liabilities.map(l => l.id === item.id ? {...l, amount: parseFloat(e.target.value)} : l))} placeholder="金額" />
                  <button onClick={() => setLiabilities(liabilities.filter(l => l.id !== item.id))}>✕</button>
                </div>
              ))}
              <button onClick={() => setLiabilities([...liabilities, { id: Date.now(), name: '', amount: 0 }])} style={{ width: '100%', padding: '10px', background: '#f2f2f7', border: 'none', borderRadius: '8px' }}>+ 新增負債</button>
            </div>

            <button onClick={() => setShowAdmin(false)} style={{ width: '100%', padding: '16px', background: '#007aff', color: '#fff', border: 'none', borderRadius: '12px', fontWeight: 'bold' }}>儲存並關閉</button>
          </div>
        </div>
      )}
    </div>
  );
}

// 通用摺疊組件
function MobileSection({ title, total, isOpen, onToggle, children, isDebt }) {
  return (
    <div style={{ background: '#fff', borderRadius: '18px', marginBottom: '8px', padding: '16px', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
      <div onClick={onToggle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 'bold' }}>{title}</span>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 'bold', color: isDebt ? '#ff3b30' : '#000' }}>{isDebt ? '-' : ''}{Math.round(total).toLocaleString()}</div>
          <div style={{ fontSize: '10px', opacity: 0.3 }}>{isOpen ? '收起 ▲' : '詳情 ▼'}</div>
        </div>
      </div>
      {isOpen && <div style={{ marginTop: '12px', borderTop: '1px solid #f2f2f7', paddingTop: '8px' }}>{children}</div>}
    </div>
  );
}

// 股票表格組件
function AssetTable({ list, calc, getColor, todayMode, setTodayMode }) {
  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', margin: '0 -12px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '20px', minWidth: '420px' }}>
        <thead>
          <tr style={{ color: '#8e8e93', borderBottom: '1px solid #f2f2f7' }}>
            {/* 代號通常建議靠左，維持 sticky 效果 */}
            <th style={{ padding: '8px 12px', position: 'sticky', left: 0, background: '#fff', zIndex: 10, textAlign: 'left' }}>代號</th>
            
            {/* 數值欄位全部置中 */}
            <th style={{ padding: '8px 12px', textAlign: 'center' }}>現價</th>
            <th 
              style={{ padding: '8px 12px', color: '#007aff', textAlign: 'center', fontWeight: 'bold' }} 
              onClick={(e) => { e.stopPropagation(); setTodayMode(todayMode === 'val' ? 'pct' : 'val'); }}
            >
              今日
            </th>
            <th style={{ padding: '8px 12px', textAlign: 'center' }}>總價</th>
            <th style={{ padding: '8px 12px', textAlign: 'center' }}>累積</th>
          </tr>
        </thead>
        <tbody>
          {list.map(item => {
            const d = calc(item);
            return (
              <tr key={item.id} style={{ borderBottom: '1px solid #f2f2f7' }}>
                {/* 內容格 - 代號靠左 */}
                <td style={{ padding: '12px 12px', position: 'sticky', left: 0, background: '#fff', fontWeight: 'bold', textAlign: 'left' }}>
                  {item.symbol}<br/><span style={{ fontSize: '15px', fontWeight: 'normal', opacity: 0.4 }}>{item.shares}股</span>
                </td>
                
                {/* 內容格 - 數值全部置中 */}
                <td style={{ padding: '12px 12px', textAlign: 'center' }}>{d.unitPrice.toLocaleString()}</td>
                <td style={{ padding: '12px 12px', color: getColor(d.today), fontWeight: 'bold', textAlign: 'center' }}>
                  {todayMode === 'val' ? Math.round(d.today).toLocaleString() : d.todayPct.toFixed(2) + '%'}
                </td>
                <td style={{ padding: '12px 12px', fontWeight: '600', textAlign: 'center' }}>{Math.round(d.mv).toLocaleString()}</td>
                <td style={{ padding: '12px 12px', color: getColor(d.total), textAlign: 'center' }}>{d.totalPct.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
export default App;
