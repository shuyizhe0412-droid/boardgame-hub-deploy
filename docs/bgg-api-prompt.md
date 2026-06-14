# BGG BoardGameGeek API接入 - 完整提示词

> 复制下面全部内容给 CodeBuddy 执行。

---

## 任务概述

为 boardgame-hub 项目接入 BoardGameGeek (BGG) API，让店家可以从BGG搜索并导入游戏数据。

---

## 一、安装依赖

在 `server/` 目录下运行：
```
npm install axios xml2js
```

---

## 二、创建后端路由文件 `server/routes/bgg.js`

新建文件，完整代码如下：

```js
const express = require('express');
const axios = require('axios');
const { parseStringPromise } = require('xml2js');
const router = express.Router();
const auth = require('../middleware/auth');

// 简单内存缓存 { key: { data, expiry } }
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30分钟

function getCached(key) {
  const entry = cache.get(key);
  if (entry && entry.expiry > Date.now()) return entry.data;
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, expiry: Date.now() + CACHE_TTL });
}

// GET /api/bgg/search?query=xxx
router.get('/search', auth, async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: '缺少 query 参数' });

    const cacheKey = `search:${query}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const url = `https://boardgamegeek.com/xmlapi2/search?query=${encodeURIComponent(query)}&type=boardgame`;
    const { data } = await axios.get(url, { timeout: 15000 });
    const parsed = await parseStringPromise(data);

    const items = parsed?.items?.item || [];
    const results = items.map(item => ({
      bggId: item.$.id,
      name: item.name?.[0]?.$.value || '',
      year: item.yearpublished?.[0]?.$.value || ''
    }));

    setCache(cacheKey, results);
    res.json(results);
  } catch (err) {
    console.error('BGG搜索失败:', err.message);
    res.status(500).json({ error: 'BGG搜索失败' });
  }
});

// GET /api/bgg/game/:bggId
router.get('/game/:bggId', auth, async (req, res) => {
  try {
    const { bggId } = req.params;

    const cacheKey = `game:${bggId}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const url = `https://boardgamegeek.com/xmlapi2/thing?id=${bggId}&stats=1`;
    const { data } = await axios.get(url, { timeout: 15000 });
    const parsed = await parseStringPromise(data);

    const item = parsed?.items?.item?.[0];
    if (!item) return res.status(404).json({ error: '游戏未找到' });

    const names = item.name || [];
    const links = item.link || [];
    const stats = item.statistics?.[0]?.ratings?.[0] || {};

    const result = {
      bggId: item.$.id,
      name: names.find(n => n.$.type === 'primary')?.$.value || names[0]?.$.value || '',
      names: names.map(n => ({ value: n.$.value, type: n.$.type })),
      description: (item.description?.[0] || '').replace(/<[^>]+>/g, '').trim(),
      image: item.image?.[0] || '',
      thumbnail: item.thumbnail?.[0] || '',
      yearPublished: item.yearpublished?.[0]?.$.value || '',
      minPlayers: item.minplayers?.[0]?.$.value || '',
      maxPlayers: item.maxplayers?.[0]?.$.value || '',
      playingTime: item.playingtime?.[0]?.$.value || '',
      minPlayTime: item.minplaytime?.[0]?.$.value || '',
      maxPlayTime: item.maxplaytime?.[0]?.$.value || '',
      age: item.age?.[0]?.$.value || '',
      categories: links
        .filter(l => l.$.type === 'boardgamecategory')
        .map(l => l.$.value),
      mechanics: links
        .filter(l => l.$.type === 'boardgamemechanic')
        .map(l => l.$.value),
      designers: links
        .filter(l => l.$.type === 'boardgamedesigner')
        .map(l => l.$.value),
      publishers: links
        .filter(l => l.$.type === 'boardgamepublisher')
        .map(l => l.$.value),
      rating: stats.average?.[0]?.$.value || '',
      weight: stats.averageweight?.[0]?.$.value || '',
      rank: stats.ranks?.[0]?.rank?.find(r => r.$.name === 'boardgame')?.$.value || ''
    };

    setCache(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('BGG游戏详情失败:', err.message);
    res.status(500).json({ error: 'BGG获取游戏详情失败' });
  }
});

module.exports = router;
```

---

## 三、注册路由 `server/index.js`

在 `server/index.js` 中找到 `app.use('/api/games', require('./routes/games'))`，
在它**之前**添加一行：

```js
app.use('/api/bgg', require('./routes/bgg'));
```

> ⚠️ 必须在 `/api/games` 之前，避免参数化路由截胡。

---

## 四、B端HTML弹窗 `server/public/index.html`

在 `</body>` 标签**之前**，添加弹窗HTML：

```html
<!-- BGG导入弹窗 -->
<div id="bgg-modal" class="modal" style="display:none;">
  <div class="modal-content modal-lg">
    <div class="modal-header">
      <h3>从BGG导入游戏</h3>
      <button class="modal-close" onclick="closeBggModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="bgg-search-bar">
        <input type="text" id="bgg-search-input" placeholder="输入游戏名称搜索BGG..." 
               onkeydown="if(event.key==='Enter')searchBgg()">
        <button id="bgg-search-btn" onclick="searchBgg()">搜索</button>
      </div>
      <div id="bgg-search-status" class="bgg-status"></div>
      <div id="bgg-search-results" class="bgg-results-list"></div>
      <div id="bgg-game-detail" class="bgg-detail" style="display:none;"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeBggModal()">取消</button>
      <button id="bgg-import-btn" class="btn btn-primary" style="display:none;" 
              onclick="importFromBgg()">导入游戏</button>
    </div>
  </div>
</div>
```

同时在游戏列表页的按钮区域（通常有"添加游戏"按钮旁边）添加：

```html
<button id="bgg-import-open-btn" class="btn btn-secondary" onclick="openBggModal()">
  从BGG导入
</button>
```

---

## 五、B端JS逻辑 `server/public/js/app.js`

文件末尾添加以下完整代码：

```js
// ========== BGG导入功能 ==========

let bggSelectedGame = null;

function openBggModal() {
  document.getElementById('bgg-modal').style.display = 'flex';
  document.getElementById('bgg-search-input').value = '';
  document.getElementById('bgg-search-results').innerHTML = '';
  document.getElementById('bgg-search-status').innerHTML = '';
  document.getElementById('bgg-game-detail').style.display = 'none';
  document.getElementById('bgg-import-btn').style.display = 'none';
  bggSelectedGame = null;
}

function closeBggModal() {
  document.getElementById('bgg-modal').style.display = 'none';
}

async function searchBgg() {
  const query = document.getElementById('bgg-search-input').value.trim();
  if (!query) return;

  const statusEl = document.getElementById('bgg-search-status');
  const resultsEl = document.getElementById('bgg-search-results');
  const searchBtn = document.getElementById('bgg-search-btn');

  statusEl.textContent = '搜索中...';
  resultsEl.innerHTML = '';
  searchBtn.disabled = true;

  try {
    const res = await apiFetch(`/bgg/search?query=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('搜索失败');

    const games = await res.json();
    if (!games.length) {
      statusEl.textContent = '未找到游戏';
      searchBtn.disabled = false;
      return;
    }

    statusEl.textContent = '找到 ' + games.length + ' 个游戏';
    resultsEl.innerHTML = games.map(g =>
      '<div class="bgg-result-item" onclick="selectBggGame(\'' + g.bggId + '\')">' +
        '<span class="bgg-result-name">' + escapeHtml(g.name) + '</span>' +
        (g.year ? '<span class="bgg-result-year">(' + g.year + ')</span>' : '') +
      '</div>'
    ).join('');
  } catch (err) {
    statusEl.textContent = '搜索失败，请重试';
  } finally {
    searchBtn.disabled = false;
  }
}

async function selectBggGame(bggId) {
  const statusEl = document.getElementById('bgg-search-status');
  const detailEl = document.getElementById('bgg-game-detail');
  const importBtn = document.getElementById('bgg-import-btn');

  statusEl.textContent = '加载游戏详情...';
  detailEl.style.display = 'none';

  try {
    const res = await apiFetch('/bgg/game/' + bggId);
    if (!res.ok) throw new Error('获取详情失败');

    const game = await res.json();
    bggSelectedGame = game;

    detailEl.innerHTML = 
      '<div class="bgg-detail-header">' +
        (game.thumbnail ? '<img src="' + game.thumbnail + '" alt="' + escapeHtml(game.name) + '" class="bgg-detail-thumb">' : '') +
        '<div>' +
          '<h4>' + escapeHtml(game.name) + '</h4>' +
          (game.yearPublished ? '<span class="bgg-detail-year">' + game.yearPublished + '</span>' : '') +
          (game.rating ? '<span class="bgg-detail-rating">BGG评分: ' + game.rating + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="bgg-detail-meta">' +
        (game.minPlayers ? '<span>玩家: ' + game.minPlayers + '-' + game.maxPlayers + '人</span>' : '') +
        (game.playingTime ? '<span>时长: ' + game.playingTime + '分钟</span>' : '') +
        (game.weight ? '<span>复杂度: ' + game.weight + '/5</span>' : '') +
      '</div>' +
      '<div class="bgg-detail-tags">' +
        (game.categories || []).slice(0, 5).map(function(c) { return '<span class="bgg-tag">' + escapeHtml(c) + '</span>'; }).join('') +
      '</div>' +
      '<p class="bgg-detail-desc">' + (game.description || '').substring(0, 300) + (game.description && game.description.length > 300 ? '...' : '') + '</p>';

    detailEl.style.display = 'block';
    importBtn.style.display = 'inline-block';
    statusEl.textContent = '';
    document.getElementById('bgg-search-results').innerHTML = '';
  } catch (err) {
    statusEl.textContent = '加载游戏详情失败';
  }
}

async function importFromBgg() {
  if (!bggSelectedGame) return;

  const importBtn = document.getElementById('bgg-import-btn');
  importBtn.disabled = true;
  importBtn.textContent = '导入中...';

  try {
    const gameData = {
      game_name: bggSelectedGame.name,
      player_min: parseInt(bggSelectedGame.minPlayers) || 1,
      player_max: parseInt(bggSelectedGame.maxPlayers) || 4,
      duration: parseInt(bggSelectedGame.playingTime) || 60,
      difficulty: Math.round(parseFloat(bggSelectedGame.weight)) || 3,
      tags: (bggSelectedGame.categories || []).slice(0, 5).join(','),
      description: (bggSelectedGame.description || '').substring(0, 500),
      bgg_id: bggSelectedGame.bggId,
      image_url: bggSelectedGame.image || '',
      thumb_url: bggSelectedGame.thumbnail || ''
    };

    const res = await apiFetch('/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(gameData)
    });

    if (!res.ok) {
      const errData = await res.json().catch(function() { return {}; });
      throw new Error(errData.error || '导入失败');
    }

    showToast('游戏导入成功！');
    closeBggModal();
    loadGames();
  } catch (err) {
    showToast('导入失败: ' + err.message);
  } finally {
    importBtn.disabled = false;
    importBtn.textContent = '导入游戏';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
```

---

## 六、B端CSS样式 `server/public/css/style.css`

文件末尾添加：

```css
/* ========== BGG导入弹窗 ========== */

.bgg-search-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.bgg-search-bar input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
}
.bgg-search-bar button {
  padding: 8px 16px;
  background: #4a90d9;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.bgg-search-bar button:hover { background: #357abd; }
.bgg-search-bar button:disabled { opacity: 0.6; cursor: not-allowed; }

.bgg-status {
  font-size: 13px;
  color: #666;
  margin-bottom: 8px;
  min-height: 20px;
}

.bgg-results-list {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid #eee;
  border-radius: 6px;
}
.bgg-result-item {
  padding: 10px 14px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
  transition: background 0.2s;
}
.bgg-result-item:hover { background: #f5f8ff; }
.bgg-result-item:last-child { border-bottom: none; }
.bgg-result-name { font-weight: 500; }
.bgg-result-year { color: #999; margin-left: 8px; font-size: 12px; }

.bgg-detail { margin-top: 16px; }
.bgg-detail-header {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
}
.bgg-detail-thumb {
  width: 80px;
  height: 80px;
  object-fit: cover;
  border-radius: 6px;
}
.bgg-detail-header h4 {
  margin: 0 0 4px 0;
  font-size: 18px;
}
.bgg-detail-year { color: #999; font-size: 13px; }
.bgg-detail-rating {
  display: block;
  color: #e6a23c;
  font-size: 13px;
  margin-top: 4px;
}

.bgg-detail-meta {
  display: flex;
  gap: 16px;
  margin-bottom: 8px;
  font-size: 13px;
  color: #666;
}
.bgg-detail-tags { margin-bottom: 8px; }
.bgg-tag {
  display: inline-block;
  padding: 2px 8px;
  margin: 2px;
  background: #e8f4fd;
  color: #4a90d9;
  border-radius: 4px;
  font-size: 12px;
}
.bgg-detail-desc {
  font-size: 13px;
  color: #555;
  line-height: 1.6;
}
```

---

## 七、数据库加列

在 Supabase SQL Editor 执行：

```sql
ALTER TABLE store_games ADD COLUMN IF NOT EXISTS bgg_id TEXT DEFAULT '';
ALTER TABLE store_games ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '';
ALTER TABLE store_games ADD COLUMN IF NOT EXISTS thumb_url TEXT DEFAULT '';
```

> SQL Editor：https://supabase.com/dashboard/project/ploumkvctjnfmrzyzfnw/sql/new

---

## 八、验证清单

| # | 验证项 | 操作 | 预期 |
|---|--------|------|------|
| 1 | 后端搜索 | 浏览器 `/api/bgg/search?query=Catan` | 返回JSON列表 |
| 2 | 后端详情 | 浏览器 `/api/bgg/game/13` | 返回卡坦岛详情 |
| 3 | B端按钮 | 打开B端游戏管理页 | 看到"从BGG导入"按钮 |
| 4 | 搜索弹窗 | 点击按钮，输入游戏名搜索 | 显示搜索结果 |
| 5 | 选择游戏 | 点击结果中的游戏 | 显示游戏详情 |
| 6 | 导入游戏 | 点击"导入游戏" | 游戏加入列表 |

---

## 九、常犯错误

1. apiFetch 不加 `/api/` 前缀 → B端 apiFetch 已自动加前缀
2. 路由注册顺序 → bgg路由必须在参数化路由之前
3. 忘记数据库加列 → 先执行SQL再测试导入
4. 没装依赖 → `npm install axios xml2js` 在 server/ 目录执行
