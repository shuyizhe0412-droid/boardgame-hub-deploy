# 描述翻译修复（更稳健方案）

## 问题

game端点的translateDescription可能因DeepSeek调用失败而静默不翻译。

## 解决方案：改为在导入时翻译

---

## 一、后端 `server/routes/bgg.js`

**删除** game端点中的描述翻译代码（那几行 translateDescription 相关代码）。

**改为** 加一个独立的翻译端点：

```js
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
```

---

## 二、前端 `server/public/js/app.js` 修改 importFromBgg

在 `importFromBgg` 中，**在发送POST之前**，先翻译描述：

```js
// 翻译描述
var descToUse = bggSelectedGame.description || '';
if (descToUse && !/[\u4e00-\u9fff]/.test(descToUse)) {
  try {
    var transRes = await apiFetch('/bgg/translate-description', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: descToUse.substring(0, 1500) })
    });
    if (transRes.ok) {
      var transData = await transRes.json();
      descToUse = transData.translated || descToUse;
    }
  } catch (e) {
    // 翻译失败用原文
  }
}

const gameData = {
  name: bggSelectedGame.name_cn || bggSelectedGame.name,
  // ... 其他字段保持不变 ...
  description: descToUse,
  // ...
};
```

> 把 gameData 中的 description 改为 `descToUse`

---

## 三、验证

导入一个游戏，看描述是否为中文。
