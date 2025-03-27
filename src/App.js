import React, { useState, useEffect } from 'react';
import './App.css';
import PQueue from 'p-queue';


function App() {
  // itemData: 「item_id.txt」から読み込んだアイテムIDと名称のマッピングを保持
  const [itemData, setItemData] = useState(null);
  // priceData: 実際にUniversalis APIから取得したアイテムの価格情報を配列で保持
  const [priceData, setPriceData] = useState([]);
  // loading: データ取得中かどうかを示すフラグ
  const [loading, setLoading] = useState(false);
  // error: エラーが起こった際のエラーメッセージを保持
  const [error, setError] = useState(null);
  // lastUpdated: 最終更新時刻を文字列として保持
  const [lastUpdated, setLastUpdated] = useState(null);
  // currentBatch: どのバッチ(区切り)を取得しているかを表すインデックス
  const [currentBatch, setCurrentBatch] = useState(0);
  
  // API取得対象（フィルター済みのアイテムデータ）         
  const [filteredItemData, setFilteredItemData] = useState(null); 

  // BATCH_SIZE: 大きなアイテムリストを分割するときの区切り数
  const BATCH_SIZE = 2700;
  // PARALLEL_BATCH_SIZE: 並列で一度に処理するアイテム数
  const PARALLEL_BATCH_SIZE = 8;
  // CACHE_DURATION: 価格をキャッシュする期間(ミリ秒)。ここでは5分
  const CACHE_DURATION = 5 * 60 * 1000;

  // 100件処理のやつ
  // const BULK_SIZE = 100;  // 一括取得サイズ
  // const BATCH_SIZE = 2700; // 全体のバッチサイズ（変更なし）
  // const UPDATE_INTERVAL = 300000; // 更新間隔：5分（キャッシュと同期）



  /**
   * バッチ単位でアイテムオブジェクトを切り出す関数
   * items: 全アイテム（IDと名前のマッピングが含まれるオブジェクト）
   * batchNumber: 取りたいバッチの番号
   */
  const getBatchItems = (items, batchNumber) => {
    // オブジェクトを配列形式（[[id, {ja: '名前'}], ...]）に変換
    const itemEntries = Object.entries(items);
    // どの部分を取り出すかの開始インデックス
    const startIndex = batchNumber * BATCH_SIZE;
    // startIndexからBATCH_SIZE分だけ切り出して、再びオブジェクト形式に戻す
    return Object.fromEntries(itemEntries.slice(startIndex, startIndex + BATCH_SIZE));
  };

  /**
   * ローカルストレージのキャッシュからデータを取得する関数
   * 有効期限内のキャッシュがあればそれを返し、期限切れの場合は削除する
   */
  const getPriceFromCache = (id) => {
    const cached = localStorage.getItem(`price_${id}`);
    if (cached) {
      const { price, timestamp } = JSON.parse(cached);
      // キャッシュのタイムスタンプがCACHE_DURATION以内なら再利用する
      if (Date.now() - timestamp < CACHE_DURATION) {
        return price;
      }
      // 期限切れなら削除してnullを返す
      localStorage.removeItem(`price_${id}`);
    }
    return null;
  };

  /**
   * ローカルストレージに価格データをキャッシュとして保存する関数
   * 価格情報と一緒に現在のタイムスタンプも保存する
   */
  const cachePriceData = (id, price) => {
    localStorage.setItem(
      `price_${id}`,
      JSON.stringify({
        price,
        timestamp: Date.now()
      })
    );
  };

  /**
   * 個別アイテムの価格をUniversalis APIから取得する関数
   * まずキャッシュをチェックして、有効ならそれを即返す
   * キャッシュにない場合、APIを呼び出して価格を取得・キャッシュを更新する
   */
  const fetchSinglePrice = async (id) => {
    // まずキャッシュをチェック
    const cachedPrice = getPriceFromCache(id);
    if (cachedPrice) {
      // キャッシュが有効であればそれを返す
      return { id, ...cachedPrice };
    }

    // APIから取得
    const response = await fetch(`https://universalis.app/api/v2/Hades/${id}`);
    if (!response.ok) {
      throw new Error(`APIエラー: アイテムID ${id} の取得に失敗しました`);
    }

    const data = await response.json();

    // listingsがあり、かつ1件以上ある場合のみ価格を計算
    if (data.listings && data.listings.length > 0) {
      // 出品されている中での最安値を取得
      const minPrice = Math.min(...data.listings.map(l => l.pricePerUnit));
      const result = {
        id,
        name: itemData[id].ja,
        price: minPrice,
        averagePrice: data.averagePrice,
        lastUploadTime: new Date(data.lastUploadTime).toLocaleString('ja-JP'),
        listingsCount: data.listings.length
      };
      // キャッシュにも保存しておく
      cachePriceData(id, {
        name: itemData[id].ja,
        price: minPrice,
        averagePrice: data.averagePrice,
        lastUploadTime: new Date(data.lastUploadTime).toLocaleString('ja-JP'),
        listingsCount: data.listings.length
      });
      return result;
    }
    // 出品が無い場合はnullを返す
    return null;
  };

  /**
   * 指定したアイテム群（バッチ）について、それぞれのアイテムの価格を取得する関数
   * fetchSinglePriceをアイテム分だけ実行して並列処理を行う
   */
  const fetchPriceBatch = async (items) => {
    // p-queueでapiの取得制御
    const queue = new PQueue({
      concurrency:PARALLEL_BATCH_SIZE, // 上限8の並列実行
      interval:1000,    //1秒間のインターバル
      intervalCap:25    //1秒間の最大リクエスト数
    });

    const entries = Object.entries(items);
    const results = [];

    // idで毎にfetchSinglericeを実行する
    for (const [id] of entries){
      queue.add(async () => {
        try{
          if (!itemData) {
            console.warn('itemDataがnullのままfetchSinglePrice呼び出し');
          }
          const result = await fetchSinglePrice(id);
          if(result) results.push(result);
        } catch (err){
          console.error(`ID:${id} エラー`, err);
        }
      });
    }
    await queue.onIdle();

    // 全てのPromiseを待機して結果をまとめて返す
    return results;
  };

  /**
   * ミリ秒単位で待機する関数
   */
  const sleep = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
  };

  /**
   * 大量のアイテムデータに対して、複数回のバッチ処理を組み合わせて全価格を取得する関数
   */
  const fetchAllPrices = async (items) => {
    // itemsが無い場合は何もせず終了
    if (!items) return;

    setLoading(true);
    setError(null);

    // 取得結果を格納する配列
    const prices = [];

    try {
      // オブジェクトを[[id, data], ...]の形式にする
      const entries = Object.entries(items);
      // 全体をPARALLEL_BATCH_SIZE(50)個ずつ分割し、それが何回必要かを算出
      const totalBatches = Math.ceil(entries.length / PARALLEL_BATCH_SIZE);

      // 分割したバッチを順番に処理する
      for (let i = 0; i < totalBatches; i++) {
        // バッチごとに取り出すアイテムの範囲を決定
        const batchItems = Object.fromEntries(
          entries.slice(i * PARALLEL_BATCH_SIZE, (i + 1) * PARALLEL_BATCH_SIZE)
        );
        // バッチを処理して価格データを取得
        const batchResults = await fetchPriceBatch(batchItems);

        // 取得結果の中でエラーになっていないものだけ抽出
        const validResults = batchResults.filter(result => result && !result.error);
        // メインの配列に追加
        prices.push(...validResults);

        // 進捗状況をコンソールに出力（日本語で）
        console.log(
          `処理状況: ${Math.min((i + 1) * PARALLEL_BATCH_SIZE, entries.length)}/${entries.length} アイテム完了`
        );

        // 次のバッチへ進む前に200msだけ待機する（最後のバッチ終了後は待機しない）
        if (i < totalBatches - 1) {
          await sleep(200);
        }
      }

      // 取得したアイテムを価格の高い順に並び替えてstateに格納
      const sortedPrices = prices.sort((a, b) => b.price - a.price);
      setPriceData(sortedPrices);
      // 最終更新時刻を更新
      setLastUpdated(new Date().toLocaleString('ja-JP'));

    } catch (err) {
      // 何らかのエラーが起こったらエラーメッセージを表示
      setError(`データ取得中にエラーが発生しました: ${err.message}`);
    } finally {
      // ローディングフラグを解除
      setLoading(false);
    }
  };

  /**
   * マウント時に「/data/item_id.txt」を読み込み、itemDataをセットする
   * 読み込んだら、最初のバッチ(0番目)を使って価格データを取得開始する
   */
  useEffect(() => {

    //item_id.txtとmakebo_item_id.txtの両方を読み込む
    Promise.all([
      fetch('/data/item_id.txt').then(response => response.json()),
      fetch('/data/makebo_item_id.txt').then(response => response.json())
    ])
      .then(([itemNameData, makeboIds]) => {
        // itemNameDataには全アイテム名、makeboIdsには検索対象のIDが含まれる
        setItemData(itemNameData);

        // makeboIdsから必要なアイテム情報だけを抽出
        const filteredItems = Object.fromEntries(
          makeboIds.map(id => [id, itemNameData[id]])
        );
        // フィルター済みデータをstateへ保存
        setFilteredItemData(filteredItems);
      })
      .catch(error => setError('アイテムデータの読み込みに失敗しました'));
  }, []);


  /**
   * itemData（全アイテムデータ）と filteredItemData（API取得対象のフィルター済みデータ）が
   * 両方揃ったタイミングで、アイテム価格取得処理（fetchAllPrices）を実行する。
   * 
   * filteredItemDataは makebo_item_id.txt の内容から絞り込んだデータ
   */
  useEffect(() => {
    // 両方のstateが揃ったタイミングだけAPI取得開始
    if (itemData && filteredItemData) {
      console.log('itemDataとfilteredItemDataが揃ったのでAPI取得開始');
      fetchAllPrices(filteredItemData);
    }
  }, [itemData, filteredItemData]);

  /**
   * 一定時間ごと(ここでは30分)に次のバッチ番号を計算し、
   * そのバッチに属するアイテムの価格を再取得する仕組み
   */
  useEffect(() => {
    const interval = setInterval(() => {
      if (itemData) {
        // 次のバッチ番号を計算
        const nextBatch = (currentBatch + 1) % Math.ceil(Object.keys(itemData).length / BATCH_SIZE);
        setCurrentBatch(nextBatch);
        // 次のバッチ用アイテムを取り出す
        const batchItems = getBatchItems(itemData, nextBatch);
        // そのバッチアイテムの価格情報を再取得
        fetchAllPrices(batchItems);
      }
    }, 300000); // 30分をミリ秒に変換(1分=60000ms → 30分=1800000ms)

    // コンポーネントがアンマウントされるときにintervalをクリア
    return () => clearInterval(interval);
  }, [itemData]);
  

// 100件処理のやつ
// useEffect(() => {
//   const interval = setInterval(() => {
//     if (itemData) {
//       // 現在のバッチから100件ずつ処理
//       const currentItems = getBatchItems(itemData, currentBatch);
//       const itemEntries = Object.entries(currentItems);
      
//       // 現在のバッチ内での位置を管理
//       const batchPosition = Math.floor((Date.now() / UPDATE_INTERVAL) % Math.ceil(BATCH_SIZE / BULK_SIZE));
      
//       // 100件ずつ取得
//       const bulkItems = Object.fromEntries(
//         itemEntries.slice(batchPosition * BULK_SIZE, (batchPosition + 1) * BULK_SIZE)
//       );
      
//       // 現在のバッチが終わったら次のバッチへ
//       if (batchPosition * BULK_SIZE >= itemEntries.length) {
//         const nextBatch = (currentBatch + 1) % Math.ceil(Object.keys(itemData).length / BATCH_SIZE);
//         setCurrentBatch(nextBatch);
//       }
      
//       fetchAllPrices(bulkItems);
//     }
//   }, UPDATE_INTERVAL); // 5分間隔に変更

//   return () => clearInterval(interval);
// }, [itemData, currentBatch]);












  /**
   * 「現在のバッチを更新」ボタンを押したとき、
   * 今のcurrentBatchに対応するアイテムの価格を再取得する
   */
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
        {/* ボタンを押すと現在のバッチを再取得 */}
        <button 
          onClick={handleRefresh} 
          disabled={loading}
          className="refresh-button"
        >
          {loading ? '更新中...' : '現在のバッチを更新'}
        </button>
        {/* 最終更新時刻および現在のバッチ情報を表示 */}
        {lastUpdated && (
          <div className="last-updated">
            <div>最終更新: {lastUpdated}</div>
            <div>
              現在のバッチ: {currentBatch + 1} (
              {currentBatch * BATCH_SIZE + 1}-
              {(currentBatch + 1) * BATCH_SIZE}番目)
            </div>
          </div>
        )}
      </div>

      {/* ローディング中は「データ取得中...」と表示 */}
      {loading && (
        <div className="loading-status">
          データ取得中...
        </div>
      )}

      {/* エラーがあれば表示 */}
      {error && <div className="result error">エラー: {error}</div>}

      {/* 価格データをソートして上位10件を表示 */}
      <div className="price-ranking">
        <h2>抽出したTop 10</h2>
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
