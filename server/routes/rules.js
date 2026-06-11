/**
 * 规则书上传 + AI 搜索路由
 * POST /api/rules/upload   - 上传规则书文件（需店家认证）→ OCR/解析 → 分页存入 rule_sections
 * POST /api/rules/search   - 关键词搜索规则段落
 * GET  /api/rules/:gameId  - 获取某游戏所有规则段落
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const supabase = require('../config/database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// DeepSeek 客户端
function getDeepSeek() {
  const key = (process.env.DEEPSEEK_API_KEY || '').trim();
  if (!key) throw new Error('DEEPSEEK_API_KEY 未配置');
  return new OpenAI({
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: key,
    timeout: 120000,
    maxRetries: 0,
  });
}

// Multer 临时存储（处理完即删）
const uploadDir = path.join(__dirname, '..', 'uploads', '_temp_rules');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});

const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'text/plain',
  'text/markdown',
  'text/x-markdown'
];
const MAX_SIZE = 20 * 1024 * 1024; // 20MB

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      // 也允许 .md 和 .txt 读作 octet-stream 的情况
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext === '.txt' || ext === '.md') {
        cb(null, true);
      } else {
        cb(new Error('不支持的文件类型：' + file.mimetype + '。支持 PDF、图片(JPG/PNG)、TXT、MD'), false);
      }
    }
  },
  limits: { fileSize: MAX_SIZE }
});

// ==================== 工具函数 ====================

// 按章节分割文本（按【】或双换行）
function splitTextIntoSections(text) {
  const sections = [];
  // 先尝试按【第X页】或【XXX】标记分割
  // 匹配【第X页】、第X页：等分页标记（不匹配【杀】【闪】等短词）
  const bracketPattern = /【第(\d+)页[^】]*】|第(\d+)页[：:]/g;
  const matches = [];
  let match;
  while ((match = bracketPattern.exec(text)) !== null) {
    matches.push({ index: match.index, len: match[0].length, page: match[1] || match[2], title: null });
  }

  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index + matches[i].len;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      let content = text.substring(start, end).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

      const pageNum = matches[i].page ? parseInt(matches[i].page) : i + 1;
      const sectionTitle = '第' + pageNum + '页';

      if (content) {
        sections.push({ page_number: pageNum, section_title: sectionTitle, content });
      }
    }
    // 如果标题前还有内容，作为第0页
    if (matches.length > 0 && matches[0].index > 0) {
      const preContent = text.substring(0, matches[0].index).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
      if (preContent) {
        sections.unshift({ page_number: 0, section_title: '前言', content: preContent });
      }
    }
    return sections;
  }

  // 无【】标记，按双换行分节
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
  if (paragraphs.length <= 1) {
    return [{ page_number: 1, section_title: '规则全文', content: text.trim() }];
  }

  // 检测是否有序号开头（如 "1. "、"一、")
  let pageNum = 1;
  return paragraphs.map(para => {
    const trimmed = para.trim();
    const numMatch = trimmed.match(/^(\d+)[\.、]|^[（(]?(\d+)[）)]|^(第[一二三四五六七八九十\d]+[章节页篇])/);
    return {
      page_number: pageNum++,
      section_title: numMatch ? numMatch[0] : ('段落 ' + (pageNum - 1)),
      content: trimmed
    };
  });
}

// OCR 图片文字
async function ocrImage(filePath, mimeType) {
  const imageBase64 = fs.readFileSync(filePath, { encoding: 'base64' });
  const client = getDeepSeek();

  const response = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: '请将这张图片中的所有文字逐字提取出来。保持段落结构。如果是规则书的某一页，标注【第X页】。只输出文字内容。'
        },
        {
          type: 'image_url',
          image_url: { url: `data:${mimeType};base64,${imageBase64}` }
        }
      ]
    }],
    max_tokens: 4000
  });

  return response.choices[0].message.content;
}

// 解析 PDF 文本
async function extractPdfText(filePath) {
  const pdfParseModule = require('pdf-parse');
  const dataBuffer = fs.readFileSync(filePath);

  // pdf-parse v2.x: 导出 { PDFParse: class, ... }
  if (pdfParseModule.PDFParse) {
    const pdf = new pdfParseModule.PDFParse({ data: dataBuffer });
    const result = await pdf.getText();
    return {
      text: result.text || '',
      numPages: result.total || 1
    };
  }

  // pdf-parse v1.x: module.exports 直接是函数
  const data = await pdfParseModule(dataBuffer);
  return {
    text: data.text || '',
    numPages: data.numpages || 1
  };
}

// 批量翻译规则段落为中文（保留【第X页】标记）
async function translateSectionsBatch(sections) {
  try {
    var combined = sections.map(function(s) {
      return '【第' + s.page_number + '页】' + (s.section_title ? '「' + s.section_title + '」' : '') + '\n' + s.content;
    }).join('\n\n---\n\n');

    var client = getDeepSeek();
    var resp = await client.chat.completions.create({
      model: 'deepseek-chat',
      temperature: 0.1,
      messages: [{
        role: 'system',
        content: '你是专业桌游规则翻译。要求：\n1. 全部翻译为中文，包括标题和小标题\n2. 严格逐段翻译，保留【第X页】标记\n3. 用 --- 分隔各段落\n4. 只有卡牌名和角色名保留原文\n5. 数字、符号原样保留\n6. 只输出翻译结果，不加解释'
      }, {
        role: 'user',
        content: '翻译以下桌游规则书为中文：\n\n' + combined
      }],
      max_tokens: Math.min(combined.length * 3, 16000)
    });

    var translated = resp.choices[0].message.content;
    console.log('[RULES] 翻译完成 | 原文:', combined.length, '字 | 译文:', translated.length, '字');

    var parts = translated.split(/\n---+\n|(?=【第\d+页】)/).filter(function(p) { return p.trim(); });
    if (parts.length !== sections.length) {
      console.warn('[RULES] 翻译段落数不匹配:', parts.length, 'vs', sections.length, '，使用原文');
      return sections;
    }

    return sections.map(function(s, i) {
      var tc = parts[i].replace(/^【第\d+页】[^\n]*\n?/, '').trim();
      if (!tc || tc.length < 5) return s;
      return { page_number: s.page_number, section_title: s.section_title, content: tc.substring(0, 10000) };
    });
  } catch (err) {
    console.warn('[RULES] 翻译失败使用原文:', err.message);
    return sections;
  }
}


// ==================== 路由 ====================

// POST /api/rules/upload - 上传规则书文件
router.post('/upload', authMiddleware, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      const msg = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
        ? '文件过大，超过20MB限制' : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: '请选择要上传的文件' });

    const filePath = req.file.path;
    const { game_id } = req.body;

    if (!game_id) {
      try { fs.unlinkSync(filePath); } catch (_) {}
      return res.status(400).json({ error: '请提供 game_id' });
    }

    try {
      // 验证游戏归属
      const { data: gameArr, error: gErr } = await supabase
        .from('store_games')
        .select('id')
        .eq('id', game_id)
        .eq('store_id', req.store.id)
        .limit(1);
      if (gErr) throw gErr;
      if (!gameArr || gameArr.length === 0) {
        try { fs.unlinkSync(filePath); } catch (_) {}
        return res.status(404).json({ error: '游戏不存在或无权限' });
      }

      const ext = path.extname(req.file.originalname).toLowerCase();
      const mimeType = req.file.mimetype;
      let text = '';

      // 按文件类型处理
      if (ext === '.txt' || ext === '.md' || mimeType === 'text/plain' || mimeType === 'text/markdown') {
        // 文本文件：直接读取
        text = fs.readFileSync(filePath, 'utf-8');
        console.log('[RULES] 文本文件:', req.file.originalname, '| 长度:', text.length);

      } else if (mimeType === 'application/pdf' || ext === '.pdf') {
        // PDF 文件：用 pdf-parse 提取
        console.log('[RULES] PDF文件:', req.file.originalname, '| 大小:', (req.file.size / 1024).toFixed(1) + 'KB');
        const pdfData = await extractPdfText(filePath);
        text = pdfData.text;
        console.log('[RULES] PDF提取完成 | 页数:', pdfData.numPages, '| 文字长度:', text.length);

        // PDF 按页分割比按【】分割更准确
        const sections = [];
        // pdf-parse 用 \n\n 分隔页面
        const pages = text.split(/\n\s*\n+/).filter(p => p.trim());
        for (let i = 0; i < pages.length; i++) {
          sections.push({
            page_number: i + 1,
            section_title: '第' + (i + 1) + '页',
            content: pages[i].trim()
          });
        }

        if (sections.length > 0) {
          // 先清空旧规则段落
          await supabase.from('rule_sections').delete().eq('game_id', game_id);
          
          // AI 翻译为中文
          var pdfSections = await translateSectionsBatch(sections);
          // 存入数据库
          const toInsert = pdfSections.map(s => ({
            id: uuidv4(),
            game_id,
            page_number: s.page_number,
            section_title: s.section_title,
            content: s.content,
            source_type: 'pdf'
          }));

          const { error: insErr } = await supabase.from('rule_sections').insert(toInsert);
          if (insErr) throw insErr;

          console.log('[RULES] PDF 规则书已存储:', sections.length, '段');
          return res.json({ success: true, sections: sections.length, file_type: 'pdf' });
        } else {
          return res.json({ success: true, sections: 0, file_type: 'pdf', warning: '未提取到文字内容' });
        }

      } else if (mimeType.startsWith('image/')) {
        // 图片文件：OCR
        console.log('[RULES] 图片文件:', req.file.originalname, '| 大小:', (req.file.size / 1024).toFixed(1) + 'KB');
        console.log('[RULES] 开始 OCR（DeepSeek Vision）...');
        text = await ocrImage(filePath, mimeType);
        console.log('[RULES] OCR 完成 | 文字长度:', text.length);

      } else {
        try { fs.unlinkSync(filePath); } catch (_) {}
        return res.status(400).json({ error: '不支持的文件类型' });
      }

      // 分割为章节存入 rule_sections
      const sections = splitTextIntoSections(text);
      if (sections.length === 0) {
        try { fs.unlinkSync(filePath); } catch (_) {}
        return res.status(400).json({ error: '未提取到有效规则内容，请确认文件格式正确' });
      }

      const sourceType = mimeType.startsWith('image/') ? 'image_ocr' : 'text';

      // 先清空旧规则段落，避免叠加
      await supabase.from('rule_sections').delete().eq('game_id', game_id);

      // AI翻译为中文
      var finalSections = await translateSectionsBatch(sections);

      const toInsert = finalSections.map(s => ({
        id: uuidv4(),
        game_id,
        page_number: s.page_number,
        section_title: s.section_title,
        content: s.content.substring(0, 10000), // 每段最多10000字
        source_type: sourceType
      }));

      const { error: insErr } = await supabase.from('rule_sections').insert(toInsert);
      if (insErr) throw insErr;

      console.log('[RULES] 规则书上传成功 | 游戏:', game_id, '| 段数:', sections.length, '| 类型:', sourceType);

      res.json({
        success: true,
        sections: sections.length,
        file_type: sourceType
      });

    } catch (err) {
      console.error('[RULES] 上传处理失败:', err.message);
      try { fs.unlinkSync(filePath); } catch (_) {}
      res.status(500).json({ error: '规则书处理失败: ' + err.message });
    } finally {
      // 清理临时文件
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
    }
  });
});

// POST /api/rules/search - 关键词搜索匹配段落
router.post('/search', async (req, res) => {
  try {
    const { game_id, question } = req.body;

    if (!game_id || !question) {
      return res.status(400).json({ error: '请提供 game_id 和 question' });
    }

    const { data: sections, error } = await supabase
      .from('rule_sections')
      .select('id, page_number, section_title, content, source_type')
      .eq('game_id', game_id)
      .order('page_number');

    if (error) throw error;
    if (!sections || sections.length === 0) {
      return res.json({ matched: [] });
    }

    // 拆关键词
    const keywords = question
      .replace(/[?？,，。.!！\s]+/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1);

    // 计分匹配
    const scored = sections.map(s => {
      let score = 0;
      const c = (s.content || '').toLowerCase();
      keywords.forEach(kw => {
        const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const matchArr = c.match(re);
        if (matchArr) score += matchArr.length;
      });
      return { ...s, score };
    }).filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    res.json({
      matched: scored.map(s => ({
        page_number: s.page_number,
        section_title: s.section_title,
        content: s.content,
        relevance_score: s.score,
        source_type: s.source_type
      }))
    });
  } catch (err) {
    console.error('[RULES] 搜索失败:', err.message);
    res.status(500).json({ error: '搜索失败' });
  }
});

// GET /api/rules/debug-translate - 测试翻译功能
router.get('/debug-translate', authMiddleware, async (req, res) => {
  try {
    var testSections = [
      { page_number: 1, section_title: '测试', content: 'Setup: Shuffle all cards and deal 7 to each player.' },
      { page_number: 2, section_title: '测试', content: 'On your turn, play a card matching color or number.' }
    ];
    var result = await translateSectionsBatch(testSections);
    res.json({ 
      success: true, 
      original: testSections.map(function(s) { return s.content; }),
      translated: result.map(function(s) { return s.content; })
    });
  } catch (err) {
    res.json({ success: false, error: err.message, stack: err.stack });
  }
});

// GET /api/rules/:gameId - 获取某游戏所有规则段落（公开）
router.get('/:gameId', async (req, res) => {
  try {
    const { data: sections, error } = await supabase
      .from('rule_sections')
      .select('id, page_number, section_title, content, source_type, created_at')
      .eq('game_id', req.params.gameId)
      .order('page_number');

    if (error) throw error;

    res.json({ sections: sections || [], total: (sections || []).length });
  } catch (err) {
    console.error('[RULES] 获取规则段落失败:', err.message);
    res.status(500).json({ error: '获取失败' });
  }
});

// DELETE /api/rules/section/:sectionId - 删除单个规则段落（需认证）
router.delete('/section/:sectionId', authMiddleware, async (req, res) => {
  try {
    // 先验证所属游戏的所有权
    const { data: sectionArr, error: findErr } = await supabase
      .from('rule_sections')
      .select('game_id')
      .eq('id', req.params.sectionId)
      .limit(1);

    if (findErr) throw findErr;
    if (!sectionArr || sectionArr.length === 0) {
      return res.status(404).json({ error: '规则段落不存在' });
    }

    // 验证游戏所有权
    const { data: gameArr, error: gErr } = await supabase
      .from('store_games')
      .select('id')
      .eq('id', sectionArr[0].game_id)
      .eq('store_id', req.store.id)
      .limit(1);

    if (gErr) throw gErr;
    if (!gameArr || gameArr.length === 0) {
      return res.status(403).json({ error: '无权限删除' });
    }

    const { error: delErr } = await supabase
      .from('rule_sections')
      .delete()
      .eq('id', req.params.sectionId);

    if (delErr) throw delErr;

    console.log('[RULES] 规则段落已删除:', req.params.sectionId);
    res.json({ message: '删除成功' });
  } catch (err) {
    console.error('[RULES] 删除失败:', err.message);
    res.status(500).json({ error: '删除失败' });
  }
});

// DELETE /api/rules/game/:gameId - 清空某游戏所有规则段落（需认证）
router.delete('/game/:gameId', authMiddleware, async (req, res) => {
  try {
    // 验证游戏所有权
    const { data: gameArr, error: gErr } = await supabase
      .from('store_games')
      .select('id')
      .eq('id', req.params.gameId)
      .eq('store_id', req.store.id)
      .limit(1);

    if (gErr) throw gErr;
    if (!gameArr || gameArr.length === 0) {
      return res.status(404).json({ error: '游戏不存在或无权限' });
    }

    const { error: delErr } = await supabase
      .from('rule_sections')
      .delete()
      .eq('game_id', req.params.gameId);

    if (delErr) throw delErr;

    console.log('[RULES] 已清空游戏规则段落:', req.params.gameId);
    res.json({ message: '已清空所有规则段落' });
  } catch (err) {
    console.error('[RULES] 清空失败:', err.message);
    res.status(500).json({ error: '清空失败' });
  }
});

module.exports = router;
