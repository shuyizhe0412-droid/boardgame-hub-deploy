/**
 * AI 规则问答路由（DeepSeek）
 * POST /api/ai/ask — 一次性返回（兼容旧版）
 * POST /api/ai/ask-stream — 流式返回（SSE）
 * 无需认证，玩家可用
 */
const express = require('express');
const OpenAI = require('openai');
const supabase = require('../config/database');

const router = express.Router();

// DeepSeek 客户端惰性初始化
function getOpenAI() {
  const key = (process.env.DEEPSEEK_API_KEY || '').trim();
  if (!key) throw new Error('DEEPSEEK_API_KEY 未配置');
  return new OpenAI({
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: key,
    timeout: 60000,
    maxRetries: 0,
  });
}

// 读取游戏信息（共用）
async function getGameInfo(game_id) {
  // 先查 store_games（用 select('*') 避免 RLS 列限制）
  try {
    const { data: storeGames, error } = await supabase
      .from('store_games')
      .select('*')
      .eq('id', game_id)
      .limit(1);

    if (!error && storeGames && storeGames.length > 0) {
      const g = storeGames[0];
      return {
        name: g.name || g.game_name || '该游戏',
        category: g.category || '桌游',
        rules_text: g.rules_text || '',
        description: g.description || '',
        source: 'store_games'
      };
    }
  } catch (e) {
    console.warn('[AI] store_games 查询异常:', e.message);
  }

  // 再查 global_games
  try {
    const { data: globalGames, error } = await supabase
      .from('global_games')
      .select('*')
      .eq('id', game_id)
      .limit(1);

    if (!error && globalGames && globalGames.length > 0) {
      const g = globalGames[0];
      return {
        name: g.game_name || g.name || '该游戏',
        category: Array.isArray(g.tags) ? g.tags.join('、') : (g.tags || '桌游'),
        rules_text: g.rules_text || '',
        description: g.description || '',
        source: 'global_games'
      };
    }
  } catch (e) {
    console.warn('[AI] global_games 查询异常:', e.message);
  }

  // 兜底：检查 rule_sections 是否有该游戏数据
  try {
    const { data: sections, error } = await supabase
      .from('rule_sections')
      .select('id')
      .eq('game_id', game_id)
      .limit(1);
    if (!error && sections && sections.length > 0) {
      return {
        name: '该游戏',
        category: '桌游',
        rules_text: '',
        description: '',
        source: 'rule_sections'
      };
    }
  } catch (e) {
    // 忽略
  }

  return null;
}

// 搜索规则书匹配段落
async function searchRuleSections(game_id, question) {
  try {
    const { data: sections, error } = await supabase
      .from('rule_sections')
      .select('page_number, section_title, content')
      .eq('game_id', game_id)
      .order('page_number');

    if (error || !sections || sections.length === 0) return null;

    // 中文：按常见分隔词切分；英文：按空格
    const cleanQ = (question || '').replace(/[?？,，。.!！\s]+/g, ' ');
    // 对中文做二字词切分（2-gram），解决无空格分词问题
    let keywords = cleanQ.split(/\s+/).filter(w => w.length > 1);
    // 额外生成二字词：对每个>2字的中文词，切分出所有连续二字组合
    const extraKW = [];
    keywords.forEach(kw => {
      if (/^[\u4e00-\u9fff]{3,}$/.test(kw)) {
        for (let i = 0; i <= kw.length - 2; i++) {
          extraKW.push(kw.substring(i, i + 2));
        }
      }
    });
    keywords = [...new Set([...keywords, ...extraKW])];

    const scored = sections.map(s => {
      let score = 0;
      const c = (s.content || '').toLowerCase();
      keywords.forEach(kw => {
        const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const m = c.match(re);
        if (m) score += m.length;
      });
      return { ...s, score };
    }).filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (scored.length === 0) {
      // 关键词无匹配：兜底返回前3段，确保中文提问也能获得规则上下文
      const fallback = sections.slice(0, 3);
      if (fallback.length === 0) return null;
      return '\n\n【规则书引用】（关键词未匹配，提供前几页供参考）\n' + fallback.map(s =>
        '第' + s.page_number + '页' + (s.section_title ? '「' + s.section_title + '」' : '') + '：' + s.content
      ).join('\n\n');
    }

    return '\n\n【规则书引用】\n' + scored.map(s =>
      '第' + s.page_number + '页' + (s.section_title ? '「' + s.section_title + '」' : '') + '：' + s.content
    ).join('\n\n');
  } catch (e) {
    console.warn('[AI] 规则搜索失败（非致命）:', e.message);
    return null;
  }
}

// 构建 system prompt（共用）
async function buildSystemPrompt(game, mode, userMessage, game_id) {
  const gameName = game.name;
  const gameCategory = game.category;
  const rules_text = game.rules_text;

  const modeInstructions = {
    setup: '你是摆盘引导助手。根据玩家人数，一步步教他们如何摆放游戏配件。每一步只说一个动作，等玩家确认后再进行下一步。',
    rules: '你是规则教学助手。系统地讲解游戏规则，从基础开始，循序渐进。每个知识点讲完后确认玩家是否理解。',
    faq: '你是规则速查助手。快速准确地回答玩家的具体规则问题，回答要简洁直接。',
    recommend: '你是桌游推荐助手。根据玩家的人数、时间、喜好推荐合适的游戏。'
  };

  const modeText = modeInstructions[mode] || modeInstructions.rules;

  // 搜索 rule_sections 中的匹配段落
  let ruleContext = rules_text || '';
  if (game_id && userMessage) {
    const matched = await searchRuleSections(game_id, userMessage);
    if (matched) {
      ruleContext += matched;
    }
  }

  let sourceInstruction = '';
  if (ruleContext.indexOf('【规则书引用】') !== -1) {
    sourceInstruction = '\n如果提供了【规则书引用】，你的回答必须基于这些内容，并标注来源如"根据规则书第X页..."。如果规则书内容不足以回答问题，明确说明"规则书中未找到相关内容"。';
  }

  if (ruleContext && ruleContext.trim() !== '') {
    return modeText + '\n\n' +
      '严格基于以下规则内容回答。如果规则中没有提到，回答"这部分规则中没有记录，建议查阅官方规则书"。' + sourceInstruction + '\n\n' +
      '游戏名称：' + gameName + '\n' +
      '规则内容：\n' + ruleContext;
  } else {
    return modeText + '\n\n' +
      '游戏名称：「' + gameName + '」，分类：「' + gameCategory + '」。\n' +
      '你没有官方规则文本，基于通用知识回答。\n' +
      '每个回答末尾加：⚠️ 以上为AI通用回答，未参考官方规则，实际请以说明书为准。';
  }
}

// ==================== 流式接口 ====================
router.post('/ask-stream', async (req, res) => {
  try {
    const { game_id, question, mode, history } = req.body;

    if (!question) {
      return res.status(400).json({ error: '请提供 question' });
    }

    let game = { name: '桌游', category: '桌游', rules_text: '' };
    if (game_id) {
      const found = await getGameInfo(game_id);
      if (found) game = found;
    }

    const systemPrompt = await buildSystemPrompt(game, mode || 'rules', question, game_id);

    // 构建消息列表（支持多轮）
    const messages = [{ role: 'system', content: systemPrompt }];

    // 加入历史对话
    if (Array.isArray(history) && history.length > 0) {
      for (const msg of history.slice(-10)) {  // 最多保留最近10轮
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: 'user', content: question });

    console.log('[AI-STREAM] game:', game.name, '| mode:', mode || 'rules', '| history:', (history || []).length, '轮');

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const stream = await getOpenAI().chat.completions.create({
      model: 'deepseek-chat',
      messages,
      max_tokens: 1000,
      temperature: 0.7,
      stream: true,
    });

    let fullAnswer = '';

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullAnswer += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    // 发送结束标记
    res.write(`data: ${JSON.stringify({ done: true, full: fullAnswer })}\n\n`);
    res.end();

    console.log('[AI-STREAM] 完成 | length:', fullAnswer.length);
  } catch (err) {
    console.error('[AI-STREAM] 错误:', err.message);
    res.write(`data: ${JSON.stringify({ error: 'AI 服务异常，请稍后重试' })}\n\n`);
    res.end();
  }
});

// ==================== 兼容旧接口 ====================
router.post('/ask', async (req, res) => {
  try {
    const { game_id, question } = req.body;

    if (!game_id || !question) {
      return res.status(400).json({ error: '请提供 game_id 和 question' });
    }

    const game = await getGameInfo(game_id);
    if (!game) {
      return res.status(404).json({ error: '游戏不存在' });
    }

    const systemPrompt = await buildSystemPrompt(game, 'rules', question, game_id);

    const completion = await getOpenAI().chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question }
      ],
      max_tokens: 500,
      temperature: 0.7
    });

    const answer = completion.choices[0]?.message?.content || 'AI 返回为空，请重试。';
    res.json({ answer });
  } catch (err) {
    console.error('[AI] 调用失败:', err.message);
    res.json({ answer: 'AI 暂时无法回答，请稍后再试。' });
  }
});


module.exports = router;
