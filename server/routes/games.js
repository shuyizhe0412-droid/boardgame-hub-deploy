/**
 * 桌游路由 - 增删改查（Supabase 版）
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// ===== 公开接口（无需认证，玩家可访问）=====

// GET /api/games/:id/rules - 获取桌游规则内容（公开）
router.get('/:id/rules', async (req, res) => {
  try {
    console.log('[GAMES] GET rules | id:', req.params.id);

    const { data: games, error } = await supabase
      .from('store_games')
      .select('id, name, rules_text, rules_json')
      .eq('id', req.params.id)
      .limit(1);

    if (error) throw error;
    if (!games || games.length === 0) {
      console.log('[GAMES] GET rules | 404: 游戏不存在');
      return res.status(404).json({ error: '游戏不存在' });
    }

    const g = games[0];
    console.log('[GAMES] GET rules | name:', g.name, '| rules_text length:', (g.rules_text || '').length);

    res.json({
      game_name: g.name,
      rules_text: g.rules_text || '',
      rules_json: g.rules_json || ''
    });
  } catch (err) {
    console.error('[GAMES] GET rules 失败:', err.message);
    res.status(500).json({ error: '获取失败' });
  }
});

// ===== 以下接口需要认证 =====
router.use(authMiddleware);

// GET /api/games - 获取游戏列表
router.get('/', async (req, res) => {
  try {
    var { page, pageSize, category, difficulty, min_players, max_players, keyword, sort } = req.query;
    page = parseInt(page) || 1;
    pageSize = parseInt(pageSize) || 100;
    var offset = (page - 1) * pageSize;

    // 构建查询
    let query = supabase
      .from('store_games')
      .select('*', { count: 'exact' })
      .eq('store_id', req.store.id);

    // 筛选条件（按 tags 字段模糊匹配，兼容逗号分隔的多标签）
    if (category) query = query.ilike('tags', `%${category}%`);
    if (difficulty) query = query.eq('difficulty', parseInt(difficulty));
    if (min_players !== undefined && min_players !== '') {
      query = query.gte('max_players', parseInt(min_players));
    }
    if (max_players !== undefined && max_players !== '') {
      query = query.lte('min_players', parseInt(max_players));
    }
    if (keyword) query = query.ilike('name', '%' + keyword + '%');

    // 排序
    switch (sort) {
      case 'name':      query = query.order('name',      { ascending: true });  break;
      case 'difficulty': query = query.order('difficulty', { ascending: true });  break;
      case 'duration':   query = query.order('duration',   { ascending: true });  break;
      case 'rating':     query = query.order('rating',     { ascending: false }); break;
      case 'price':      query = query.order('price',      { ascending: true });  break;
      default:           query = query.order('created_at', { ascending: false }); break;
    }

    // 分页
    query = query.range(offset, offset + pageSize - 1);

    const { data: games, error, count: total } = await query;
    if (error) throw error;

    // 批量查询 file_count（避免 N+1）
    if (games && games.length > 0) {
      const gameIds = games.map(g => g.id);
      const { data: files, error: fErr } = await supabase
        .from('game_files')
        .select('game_id')
        .in('game_id', gameIds);
      if (fErr) throw fErr;

      const countMap = {};
      (files || []).forEach(f => { countMap[f.game_id] = (countMap[f.game_id] || 0) + 1; });
      games.forEach(g => { g.file_count = countMap[g.id] || 0; });
    }

    res.json(games);
  } catch (err) {
    console.error('[GAMES] 列表查询失败:', err.message);
    res.status(500).json({ error: '查询失败' });
  }
});

// GET /api/games/:id - 获取游戏详情
router.get('/:id', async (req, res) => {
  try {
    const { data: games, error } = await supabase
      .from('store_games')
      .select('*')
      .eq('id', req.params.id)
      .eq('store_id', req.store.id)
      .limit(1);

    if (error) throw error;
    if (!games || games.length === 0) {
      return res.status(404).json({ error: '游戏不存在' });
    }

    const game = games[0];

    const { data: files, error: fErr } = await supabase
      .from('game_files')
      .select('*')
      .eq('game_id', req.params.id)
      .order('created_at', { ascending: false });

    if (fErr) throw fErr;

    res.json({ game, files: files || [] });
  } catch (err) {
    console.error('[GAMES] 详情查询失败:', err.message);
    res.status(500).json({ error: '查询失败' });
  }
});

// POST /api/games - 创建游戏
router.post('/', async (req, res) => {
  try {
    var { name, category, description, min_players, max_players, duration, difficulty, price, stock, cover_image, tags, bgg_id, image_url, thumb_url } = req.body;

    if (!name) {
      return res.status(400).json({ error: '游戏名称为必填项' });
    }

    const id = uuidv4();
    const { error } = await supabase.from('store_games').insert([{
      id,
      store_id: req.store.id,
      name,
      category: category || tags || '',
      description: description || '',
      min_players: parseInt(min_players) || 1,
      max_players: parseInt(max_players) || 10,
      duration: parseInt(duration) || 30,
      difficulty: parseInt(difficulty) || 2,
      price: parseFloat(price) || 0,
      stock: parseInt(stock) || 0,
      cover_image: cover_image || '',
      bgg_id: bgg_id || '',
      image_url: image_url || '',
      thumb_url: thumb_url || ''
    }]);

    if (error) throw error;

    console.log('[GAMES] 创建游戏:', name, '| 店家:', req.store.store_name);

    const { data: gameArr } = await supabase.from('store_games').select('*').eq('id', id).limit(1);
    const game = gameArr && gameArr[0];

    res.status(201).json({ message: '创建成功', game });
  } catch (err) {
    console.error('[GAMES] 创建失败:', err.message);
    res.status(500).json({ error: '创建失败' });
  }
});

// GET /api/games/:id/rules - 获取桌游规则内容（需认证）
router.get('/:id/rules', async (req, res) => {
  try {
    const { data: existingArr, error: findErr } = await supabase
      .from('store_games')
      .select('id, name, store_id, rules_text, rules_json')
      .eq('id', req.params.id)
      .eq('store_id', req.store.id)
      .limit(1);
    if (findErr) throw findErr;
    if (!existingArr || existingArr.length === 0) {
      return res.status(404).json({ error: '游戏不存在或无权访问' });
    }
    res.json({ rules_text: existingArr[0].rules_text || '', rules_json: existingArr[0].rules_json || '' });
  } catch (err) {
    console.error('[GAMES] 获取规则失败:', err.message);
    res.status(500).json({ error: '获取失败' });
  }
});

// PUT /api/games/:id/rules - 更新桌游规则内容（需认证）
// 放在 PUT /:id 前面，避免被通用更新路由先匹配
router.put('/:id/rules', async (req, res) => {
  try {
    const { rules_text, rules_json } = req.body;
    console.log('[GAMES] PUT rules | id:', req.params.id, '| body keys:', Object.keys(req.body).join(', '), '| rules_text length:', (rules_text || '').length);

    // 验证所有权
    const { data: existingArr, error: findErr } = await supabase
      .from('store_games')
      .select('id, name, store_id')
      .eq('id', req.params.id)
      .eq('store_id', req.store.id)
      .limit(1);

    if (findErr) throw findErr;
    if (!existingArr || existingArr.length === 0) {
      console.log('[GAMES] PUT rules | 404: store_id 不匹配或不存在');
      return res.status(404).json({ error: '游戏不存在或无权修改' });
    }

    const updateData = { updated_at: new Date().toISOString() };
    if (rules_text !== undefined) updateData.rules_text = String(rules_text);
    if (rules_json !== undefined) updateData.rules_json = String(rules_json);

    console.log('[GAMES] PUT rules | updateData:', Object.keys(updateData).join(', '));

    const { error: updErr } = await supabase
      .from('store_games')
      .update(updateData)
      .eq('id', req.params.id);

    if (updErr) throw updErr;

    console.log('[GAMES] PUT rules ✅ | name:', existingArr[0].name);
    res.json({ message: '规则更新成功' });
  } catch (err) {
    console.error('[GAMES] PUT rules 失败:', err.message);
    res.status(500).json({ error: '更新失败' });
  }
});

// PUT /api/games/:id - 更新游戏
router.put('/:id', async (req, res) => {
  try {
    // 验证所有权
    const { data: existingArr, error: findErr } = await supabase
      .from('store_games')
      .select('*')
      .eq('id', req.params.id)
      .eq('store_id', req.store.id)
      .limit(1);

    if (findErr) throw findErr;
    if (!existingArr || existingArr.length === 0) {
      return res.status(404).json({ error: '游戏不存在或无权修改' });
    }

    const existing = existingArr[0];
    const { name, category, description, min_players, max_players, duration, difficulty, price, stock, cover_image } = req.body;

    const updated = {
      name:         name         !== undefined ? name         : existing.name,
      category:     category     !== undefined ? category     : existing.category,
      description:  description  !== undefined ? description  : existing.description,
      min_players:  min_players !== undefined ? parseInt(min_players) : existing.min_players,
      max_players:  max_players !== undefined ? parseInt(max_players) : existing.max_players,
      duration:     duration     !== undefined ? parseInt(duration)    : existing.duration,
      difficulty:   difficulty   !== undefined ? parseInt(difficulty)  : existing.difficulty,
      price:        price        !== undefined ? parseFloat(price)      : existing.price,
      stock:        stock        !== undefined ? parseInt(stock)       : existing.stock,
      cover_image:  cover_image !== undefined ? cover_image : existing.cover_image,
      updated_at:  new Date().toISOString()
    };

    const { error: updErr } = await supabase
      .from('store_games')
      .update(updated)
      .eq('id', req.params.id);

    if (updErr) throw updErr;

    console.log('[GAMES] 更新游戏:', updated.name);

    const { data: gameArr } = await supabase.from('store_games').select('*').eq('id', req.params.id).limit(1);
    const game = gameArr && gameArr[0];

    res.json({ message: '更新成功', game });
  } catch (err) {
    console.error('[GAMES] 更新失败:', err.message);
    res.status(500).json({ error: '更新失败' });
  }
});

// DELETE /api/games/:id - 删除游戏
router.delete('/:id', async (req, res) => {
  try {
    const { data: existingArr, error: findErr } = await supabase
      .from('store_games')
      .select('name')
      .eq('id', req.params.id)
      .eq('store_id', req.store.id)
      .limit(1);

    if (findErr) throw findErr;
    if (!existingArr || existingArr.length === 0) {
      return res.status(404).json({ error: '游戏不存在或无权删除' });
    }

    // 级联删除 game_files（外键 ON DELETE CASCADE）
    const { error: delErr } = await supabase
      .from('store_games')
      .delete()
      .eq('id', req.params.id);

    if (delErr) throw delErr;

    console.log('[GAMES] 删除游戏:', existingArr[0].name);

    res.json({ message: '删除成功' });
  } catch (err) {
    console.error('[GAMES] 删除失败:', err.message);
    res.status(500).json({ error: '删除失败' });
  }
});

// ===== 批量添加（从全局游戏库复制） =====

/**
 * POST /api/games/batch-add
 * 从 global_games 批量复制到 store_games（需认证）
 * Body: { game_ids: ["id1","id2",...] }
 * 返回: { added: N, skipped: M }
 */
router.post('/batch-add', async (req, res) => {
  try {
    const { game_ids } = req.body;
    if (!game_ids || !Array.isArray(game_ids) || game_ids.length === 0) {
      return res.status(400).json({ error: '请提供 game_ids 数组' });
    }

    // 1. 查全局游戏库中匹配的游戏
    const { data: globalGames, error: gErr } = await supabase
      .from('global_games')
      .select('*')
      .in('id', game_ids);

    if (gErr) throw gErr;
    if (!globalGames || globalGames.length === 0) {
      return res.status(404).json({ error: '未找到匹配的全局游戏' });
    }

    // 2. 查店家已有的游戏（按 name 去重）
    const { data: existingGames, error: eErr } = await supabase
      .from('store_games')
      .select('name')
      .eq('store_id', req.store.id);

    if (eErr) throw eErr;

    var existingNames = {};
    (existingGames || []).forEach(function (g) { existingNames[g.name] = true; });

    // 3. 过滤出新增的
    var newRows = [];
    var skipped = 0;
    globalGames.forEach(function (g) {
      if (existingNames[g.game_name]) {
        skipped++;
      } else {
        newRows.push({
          id: uuidv4(),
          store_id: req.store.id,
          name: g.game_name,
          cover_image: g.cover_url || '',
          min_players: g.player_min,
          max_players: g.player_max,
          duration: g.duration,
          difficulty: g.difficulty,
          tags: g.tags || '',
          source: 'default'
        });
      }
    });

    // 4. 批量插入新增的
    if (newRows.length > 0) {
      var batchSize = 100;
      for (var i = 0; i < newRows.length; i += batchSize) {
        var batch = newRows.slice(i, i + batchSize);
        var { error: insErr } = await supabase.from('store_games').insert(batch);
        if (insErr) throw insErr;
      }
    }

    console.log('[GAMES] batch-add | 店家: ' + req.store.store_name +
      ' | 新增: ' + newRows.length + ' | 跳过: ' + skipped);

    res.json({
      added: newRows.length,
      skipped: skipped,
      total: globalGames.length
    });
  } catch (err) {
    console.error('[GAMES] batch-add 失败:', err.message);
    res.status(500).json({ error: '批量添加失败: ' + err.message });
  }
});

module.exports = router;