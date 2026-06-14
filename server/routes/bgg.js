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
