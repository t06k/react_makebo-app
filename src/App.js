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
  const PARALLEL_BATCH_SIZE = 50; // 並列処理用のバッチサイズ
  const CACHE_DURATION = 5 * 60 * 1000; // 5分のキャッシュ期限

  // バッチ単位でアイテムを取得する関数
  const getBatchItems = (items, batchNumber) => {
    const itemEntries = Object.entries(items);
    const startIndex = batchNumber * BATCH_SIZE;
    return Object.fromEntries(itemEntries.slice(startIndex, startIndex + BATCH_SIZE));
  };

  // キャッシュからデータを取得
  const getPriceFromCache = (id) => {
    const cached = localStorage.getItem(`price_${id}`);
    if (cached) {
      const { price, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_DURATION) {
        return price;
      }
      localStorage.removeItem(`price_${id}`);
    }
    return null;
  };

  // キャッシュにデータを保存
  const cachePriceData = (id, price) => {
    localStorage.setItem(`price_${id}`, JSON.stringify({
      price,
      timestamp: Date.now()
    }));
  };

  // 単一アイテムの価格を取得
  const fetchSinglePrice = async (id) => {
    const cachedPrice = getPriceFromCache(id);
    if (cachedPrice) return { id, ...cachedPrice };

    const response = await fetch(`https://universalis.app/api/v2/Hades/${id}`);
    if (!response.ok) throw new Error(`APIエラー: アイテムID ${id} の取得に失敗しました`);
    
    const data = await response.json();
    if (data.listings && data.listings.length > 0) {
      const minPrice = Math.min(...data.listings.map(l => l.pricePerUnit));
      const result = {
        id,
        name: itemData[id].ja,
        price: minPrice,
        averagePrice: data.averagePrice,
        lastUploadTime: new Date(data.lastUploadTime).toLocaleString('ja-JP'),
        listingsCount: data.listings.length
      };
      cachePriceData(id, {
        name: itemData[id].ja,
        price: minPrice,
        averagePrice: data.averagePrice,
        lastUploadTime: new Date(data.lastUploadTime).toLocaleString('ja-JP'),
        listingsCount: data.listings.length
      });
      return result;
    }
    return null;
  };

  // バッチ処理で価格を取得
  const fetchPriceBatch = async (items) => {
    const batchPromises = Object.entries(items).map(([id]) => 
      fetchSinglePrice(id).catch(err => ({ id, error: err.message }))
    );
    return Promise.all(batchPromises);
  };

  // メイン処理：全アイテムの価格を取得
  const fetchAllPrices = async (items) => {
    if (!items) return;
    
    setLoading(true);
    setError(null);
    const prices = [];

    try {
      const entries = Object.entries(items);
      const totalBatches = Math.ceil(entries.length / PARALLEL_BATCH_SIZE);

      for (let i = 0; i < totalBatches; i++) {
        const batchItems = Object.fromEntries(
          entries.slice(i * PARALLEL_BATCH_SIZE, (i + 1) * PARALLEL_BATCH_SIZE)
        );
        const batchResults = await fetchPriceBatch(batchItems);
        const validResults = batchResults.filter(result => result && !result.error);
        prices.push(...validResults);

        // 進捗状況を日本語で表示
        console.log(`処理状況: ${Math.min((i + 1) * PARALLEL_BATCH_SIZE, entries.length)}/${entries.length} アイテム完了`);
      }

      // 価格の高い順にソート
      const sortedPrices = prices.sort((a, b) => b.price - a.price);
      setPriceData(sortedPrices);
      setLastUpdated(new Date().toLocaleString('ja-JP'));
    } catch (err) {
      setError(`データ取得中にエラーが発生しました: ${err.message}`);
    } finally {
      setLoading(false);
    }
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

  // 一定時間ごとに次のバッチを取得
  useEffect(() => {
    const interval = setInterval(() => {
      if (itemData) {
        const nextBatch = (currentBatch + 1) % Math.ceil(Object.keys(itemData).length / BATCH_SIZE);
        setCurrentBatch(nextBatch);
        const batchItems = getBatchItems(itemData, nextBatch);
        fetchAllPrices(batchItems);
      }
    }, 1800000); // 1時間 = 3600000ミリ秒
                // 30分 = 1800000ミリ秒

    return () => clearInterval(interval);
  }, [itemData, currentBatch]);

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
            <div>最終更新: {lastUpdated}</div>
            <div>現在のバッチ: {currentBatch + 1} ({currentBatch * BATCH_SIZE + 1}-{(currentBatch + 1) * BATCH_SIZE}番目)</div>
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
            <span className="item-average-price">平均価格: {item.averagePrice.toLocaleString()} Gil</span>
            <span className="item-listings-count">出品数: {item.listingsCount}</span>
            <span className="item-last-upload-time">最終更新: {item.lastUploadTime}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;