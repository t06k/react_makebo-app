import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [itemData, setItemData] = useState(null);
  const [priceData, setPriceData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [currentBatch, setCurrentBatch] = useState(0);
  const BATCH_SIZE = 3900;

  // バッチ単位でアイテムを取得する関数
  const getBatchItems = (items, batchNumber) => {
    const itemEntries = Object.entries(items);
    const startIndex = batchNumber * BATCH_SIZE;
    return Object.fromEntries(itemEntries.slice(startIndex, startIndex + BATCH_SIZE));
  };

  // item_id.txtを読み込む
  useEffect(() => {
    fetch('/data/item_id.txt')
      .then(response => response.json())
      .then(data => {
        setItemData(data);
        // 初回読み込み時に最初の3900件のアイテムの価格を取得
        const firstBatchItems = getBatchItems(data, 0);
        fetchAllPrices(firstBatchItems);
      })
      .catch(error => setError('アイテムデータの読み込みに失敗しました'));
  }, []);

  // 1時間ごとに次のバッチを取得
  useEffect(() => {
    const interval = setInterval(() => {
      if (itemData) {
        const nextBatch = (currentBatch + 1) % Math.ceil(Object.keys(itemData).length / BATCH_SIZE);
        setCurrentBatch(nextBatch);
        const batchItems = getBatchItems(itemData, nextBatch);
        fetchAllPrices(batchItems);
      }
    }, 3600000); // 1時間 = 3600000ミリ秒

    return () => clearInterval(interval);
  }, [itemData, currentBatch]);

  // アイテムの価格を取得する関数
  const fetchAllPrices = async (items) => {
    if (!items) return;
    
    setLoading(true);
    setError(null);
    const prices = [];

    try {
      // 進捗状況の表示用
      let processed = 0;
      const total = Object.keys(items).length;

      for (const [id, item] of Object.entries(items)) {
        try {
          const response = await fetch(
            `https://universalis.app/api/v2/Hades/${id}`
          );

          if (response.ok) {
            const data = await response.json();
            if (data.listings && data.listings.length > 0) {
              const minPrice = Math.min(...data.listings.map(l => l.pricePerUnit));
              prices.push({
                id: id,
                name: item.ja,
                price: minPrice
              });
            }
          }

          // 進捗状況を更新
          processed++;
          if (processed % 10 === 0) {
            console.log(`処理進捗: ${processed}/${total}`);
          }

        } catch (err) {
          console.error(`Error fetching price for item ${id}:`, err);
        }
      }

      // 価格の高い順にソート
      const sortedPrices = prices.sort((a, b) => b.price - a.price);
      setPriceData(sortedPrices);
      setLastUpdated(new Date().toLocaleString());
    } catch (err) {
      setError('価格データの取得中にエラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  // 価格更新ボタンのハンドラー
  const handleRefresh = () => {
    if (itemData) {
      const batchItems = getBatchItems(itemData, currentBatch);
      fetchAllPrices(batchItems);
    }
  };

  return (
    <div className="container">
      <h1>ランキング</h1>
      
      <div className="control-panel">
        <button 
          onClick={handleRefresh} 
          disabled={loading}
          className="refresh-button"
        >
          {loading ? '更新中...' : '現在のバッチを更新'}
        </button>
        {lastUpdated && (
          <div className="last-updated">
            最終更新: {lastUpdated}
            <br />
            現在のバッチ: {currentBatch + 1} ({currentBatch * BATCH_SIZE + 1}-{(currentBatch + 1) * BATCH_SIZE}番目)
          </div>
        )}
      </div>

      {loading && (
        <div className="loading-status">
          データ取得中...
        </div>
      )}

      {error && <div className="result error">エラー: {error}</div>}
      
      <div className="price-ranking">
        <h2>ランダム抽出の最高額Top 10</h2>
        {priceData.slice(0, 10).map((item, index) => (
          <div key={item.id} className="price-item">
            <span className="rank">{index + 1}.</span>
            <span className="item-name">{item.name}</span>
            <span className="item-price">{item.price.toLocaleString()} Gil</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;