const express = require('express');
const axios = require('axios');
const https = require('https');
const { parseStringPromise } = require('xml2js');
const router = express.Router();
const auth = require('../middleware/auth');

// BGG API 认证
const BGG_TOKEN = 'f9f5f152-ef1e-4034-928e-9d15a9a266a1';
const bggHeaders = {
  'User-Agent': 'BoardgameHub/1.0',
  'Authorization': 'Bearer ' + BGG_TOKEN
};

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
    const { data } = await axios.get(url, { timeout: 15000, headers: bggHeaders });
    const parsed = await parseStringPromise(data);

    const items = parsed?.items?.item || [];
    const results = items.map(item => ({
      bggId: item.$.id,
      name: item.name?.[0]?.$.value || '',
      year: item.yearpublished?.[0]?.$.value || ''
    }));

    const translated = await translateGameNames(results);
    setCache(cacheKey, translated);
    res.json(translated);
  } catch (err) {
    console.error('BGG搜索失败:', err.message);
    const errDetail = err.response ? err.response.status + ' ' + err.response.statusText + ' ' + JSON.stringify(err.response.data).substring(0,200) : err.message;
    res.status(500).json({ error: 'BGG搜索失败: ' + errDetail });
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
    const { data } = await axios.get(url, { timeout: 15000, headers: bggHeaders });
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

    // 翻译游戏名
    const translated = await translateGameNames([result]);
    if (translated.length && translated[0].name_cn) {
      result.name_cn = translated[0].name_cn;
    }
    setCache(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('BGG游戏详情失败:', err.message);
    const errDetail2 = err.response ? err.response.status + ' ' + err.response.statusText + ' ' + JSON.stringify(err.response.data).substring(0,200) : err.message;
    res.status(500).json({ error: 'BGG游戏详情失败: ' + errDetail2 });
  }
});

// GET /api/bgg/hot — 获取BGG热门游戏列表
router.get('/hot', auth, async (req, res) => {
  try {
    const cacheKey = 'hot:games';
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    // 用BGG Hot API获取当前热门游戏
    const url = 'https://boardgamegeek.com/xmlapi2/hot?type=boardgame';
    const { data } = await axios.get(url, { timeout: 15000, headers: bggHeaders });
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

    const translated = await translateGameNames(results);
    setCache(cacheKey, translated);
    res.json(translated);
  } catch (err) {
    console.error('BGG热门游戏获取失败:', err.message);
    const errDetail3 = err.response ? err.response.status + ' ' + err.response.statusText + ' ' + JSON.stringify(err.response.data).substring(0,200) : err.message;
    res.status(500).json({ error: 'BGG热门游戏获取失败: ' + errDetail3 });
  }
});

// ========== 游戏名翻译 ==========

// 批量翻译游戏名（一次请求翻多个，省token）
async function translateGameNames(games) {
  if (!games || !games.length) return games;

  const namesToTranslate = games
    .filter(function(g) { return g.name && !/[\u4e00-\u9fff]/.test(g.name); })
    .map(function(g) { return g.name; });

  if (!namesToTranslate.length) return games;

  try {
    const prompt = '将以下英文桌游名称翻译成中文桌游常用译名，只返回翻译结果，每行一个，不要任何解释：\n' +
                   namesToTranslate.join('\n');

    const translations = await callDeepSeek(prompt);
    const lines = translations.split('\n').filter(function(l) { return l.trim(); });

    // 创建翻译映射
    const map = {};
    for (var i = 0; i < namesToTranslate.length && i < lines.length; i++) {
      map[namesToTranslate[i]] = lines[i].trim();
    }

    // 应用到games
    return games.map(function(g) {
      if (map[g.name]) {
        return Object.assign({}, g, { name_cn: map[g.name] });
      }
      return g;
    });
  } catch (err) {
    console.error('翻译失败:', err.message);
    return games;
  }
}

// 调用DeepSeek API
function callDeepSeek(prompt) {
  return new Promise(function(resolve, reject) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return reject(new Error('DEEPSEEK_API_KEY 未设置'));

    const data = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: '你是桌游翻译专家，精通中文桌游圈常用译名。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 2000
    });

    const req = https.request({
      hostname: 'api.deepseek.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 30000
    }, function(res) {
      var body = '';
      res.on('data', function(chunk) { body += chunk; });
      res.on('end', function() {
        try {
          const json = JSON.parse(body);
          resolve(json.choices[0].message.content);
        } catch (e) {
          reject(new Error('解析DeepSeek响应失败'));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// POST /api/bgg/translate-description
router.post('/translate-description', auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || text.length < 50) {
      return res.json({ translated: text });
    }

    // 已有中文就不翻
    if (/[\u4e00-\u9fff]/.test(text) && text.length > 100) {
      return res.json({ translated: text });
    }

    const prompt = '将以下英文桌游描述翻译成中文，保持原文风格和信息量。只返回翻译结果：\n\n' + text.substring(0, 1500);
    const translated = await callDeepSeek(prompt);

    res.json({ translated: translated || text });
  } catch (err) {
    console.error('翻译失败:', err.message);
    res.json({ translated: req.body.text }); // 失败返回原文
  }
});

module.exports = router;
