const refreshPrices = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await fetchRateFromCloud();
      const csvRes = await fetch(`${PRICE_CSV_URL}&t=${Date.now()}`);
      const csvText = await csvRes.text();
      
      // 這裡優化：將 CSV 轉為陣列，避免 match 抓錯數字
      const rows = csvText.split('\n').map(r => r.split(','));
      // 假設台股價格在 CSV 的第二行第二欄 (1,1)，昨收在第二行第三欄 (1,2)
      // 若你的 CSV 格式不同，請調整索引
      const backupPrice = parseFloat(rows[1]?.[1]) || 0;
      const backupPrevClose = parseFloat(rows[1]?.[2]) || backupPrice; 
      
      const updated = await Promise.all(assets.map(async (item) => {
        if (!item.symbol) return item;
        try {
          // 美股走 API
          if (!/^\d/.test(item.symbol)) {
            const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${item.symbol}&token=${API_KEY}`);
            const data = await res.json();
            if (data.c) {
              return { ...item, price: data.c, prevClose: data.pc || data.c };
            }
          } else {
            // 台股走 CSV 備份
            return { ...item, price: backupPrice, prevClose: backupPrevClose };
          }
        } catch (e) {
          console.error(`更新 ${item.symbol} 失敗`, e);
        }
        return item;
      }));
      setAssets(updated);
      await fetchHistoryFromCloud();
    } catch (e) { 
      console.error("更新價格流程失敗", e); 
    } finally { 
      setLoading(false); 
    }
  }, [assets, loading, fetchRateFromCloud, fetchHistoryFromCloud, PRICE_CSV_URL, API_KEY]);
