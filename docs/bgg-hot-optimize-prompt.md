# BGG导入优化：预加载热门桌游 + 搜索加速

> 复制下面全部内容给 CodeBuddy 执行。

---

## 一、后端 `server/routes/bgg.js` 添加热门游戏端点

在 `module.exports = router;` **之前**，添加以下代码：

```js
// GET /api/bgg/hot — 获取BGG热门游戏列表
router.get('/hot', auth, async (req, res) => {
  try {
    const cacheKey = 'hot:games';
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    // 用BGG Hot API获取当前热门游戏
    const url = 'https://boardgamegeek.com/xmlapi2/hot?type=boardgame';
    const { data } = await axios.get(url, { timeout: 15000 });
    const parsed = await parseStringPromise(data);

    const items = parsed?.items?.item || [];
    const results = items.slice(0, 60).map(function(item) {
      return {
        bggId: item.$.id,
        name: item.name?.[0]?.$.value || '',
        year: item.yearpublished?.[0]?.$.value || '',
        rank: item.$.rank || ''
      };
    });

    setCache(cacheKey, results);
    res.json(results);
  } catch (err) {
    console.error('BGG热门游戏获取失败:', err.message);
    res.status(500).json({ error: 'BGG热门游戏获取失败' });
  }
});
```

---

## 二、前端 `server/public/js/app.js` 修改弹窗逻辑

**替换** `openBggModal` 函数为以下版本：

```js
function openBggModal() {
  document.getElementById('bgg-modal').style.display = 'flex';
  document.getElementById('bgg-search-input').value = '';
  document.getElementById('bgg-search-results').innerHTML = '';
  document.getElementById('bgg-search-status').innerHTML = '';
  document.getElementById('bgg-game-detail').style.display = 'none';
  document.getElementById('bgg-import-btn').style.display = 'none';
  bggSelectedGame = null;
  
  // 自动加载热门游戏
  loadHotGames();
}

async function loadHotGames() {
  var statusEl = document.getElementById('bgg-search-status');
  var resultsEl = document.getElementById('bgg-search-results');

  statusEl.textContent = '加载热门桌游...';
  resultsEl.innerHTML = '';

  try {
    var res = await apiFetch('/bgg/hot');
    if (!res.ok) throw new Error('加载失败');

    var games = await res.json();
    statusEl.textContent = '热门桌游（也可搜索）';

    resultsEl.innerHTML = games.map(function(g) {
      return '<div class="bgg-result-item" onclick="selectBggGame(\'' + g.bggId + '\')">' +
        '<span class="bgg-result-rank">#' + g.rank + '</span>' +
        '<span class="bgg-result-name">' + escapeHtml(g.name) + '</span>' +
        (g.year ? '<span class="bgg-result-year">(' + g.year + ')</span>' : '') +
      '</div>';
    }).join('');
  } catch (err) {
    statusEl.textContent = '加载热门失败，请直接搜索';
  }
}
```

**替换** `searchBgg` 函数为以下版本（加超时处理 + 更好的状态提示）：

```js
async function searchBgg() {
  var query = document.getElementById('bgg-search-input').value.trim();
  if (!query) return;

  var statusEl = document.getElementById('bgg-search-status');
  var resultsEl = document.getElementById('bgg-search-results');
  var searchBtn = document.getElementById('bgg-search-btn');

  statusEl.textContent = '搜索中...（BGG较慢请耐心等待）';
  resultsEl.innerHTML = '';
  searchBtn.disabled = true;

  try {
    var res = await apiFetch('/bgg/search?query=' + encodeURIComponent(query));
    if (!res.ok) throw new Error('搜索失败');

    var games = await res.json();
    if (!games.length) {
      statusEl.textContent = '未找到游戏，换个关键词试试';
      searchBtn.disabled = false;
      return;
    }

    statusEl.textContent = '找到 ' + games.length + ' 个结果';
    resultsEl.innerHTML = games.map(function(g) {
      return '<div class="bgg-result-item" onclick="selectBggGame(\'' + g.bggId + '\')">' +
        '<span class="bgg-result-name">' + escapeHtml(g.name) + '</span>' +
        (g.year ? '<span class="bgg-result-year">(' + g.year + ')</span>' : '') +
      '</div>';
    }).join('');
  } catch (err) {
    statusEl.textContent = '搜索超时或失败，请重试';
  } finally {
    searchBtn.disabled = false;
  }
}
```

> ⚠️ 不改动 `selectBggGame`、`importFromBgg`、`closeBggModal`、`escapeHtml` 函数。

---

## 三、前端 `server/public/css/style.css` 加排名样式

文件末尾添加：

```css
.bgg-result-rank {
  display: inline-block;
  width: 36px;
  color: #e6a23c;
  font-weight: bold;
  font-size: 13px;
}
```

---

## 四、验证

完成后刷新B端页面，验证：
1. 打开弹窗 → 自动显示热门桌游列表（排名+名称+年份）
2. 热门列表中有排名字段
3. 搜索框依然可用
4. 搜索时显示"BGG较慢请耐心等待"
