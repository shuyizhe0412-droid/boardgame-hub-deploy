# BGG描述中文翻译

## 任务

在从BGG导入游戏时，自动翻译英文描述为中文。

---

## 一、在 `server/routes/bgg.js` 添加描述翻译函数

在 `callDeepSeek` 函数**之后**（`module.exports = router;` 之前），添加：

```js
// 翻译游戏描述
async function translateDescription(game) {
  if (!game || !game.description) return game;
  
  // 如果描述已经有中文，不翻译
  if (/[\u4e00-\u9fff]/.test(game.description) && game.description.length > 100) {
    return game;
  }

  try {
    const prompt = '将以下英文桌游描述翻译成中文，保持原文风格和信息量：\n\n' + 
                   game.description.substring(0, 1500);
    
    const translation = await callDeepSeek(prompt);
    if (translation && translation.length > 50) {
      game.description_cn = translation;
    }
  } catch (err) {
    console.error('描述翻译失败:', err.message);
  }
  return game;
}
```

**在game端点中**，找到翻译游戏名的代码后面，`setCache` 之前，添加：

```js
// 翻译描述
if (result.description && result.description.length > 50) {
  const descCn = await translateDescription(result);
  if (descCn.description_cn) {
    result.description_cn = descCn.description_cn;
  }
}
```

---

## 二、前端 `server/public/js/app.js` 修改导入

在 `importFromBgg` 的 `gameData` 中，把：

```js
description: bggSelectedGame.description || '',
```

改为：

```js
description: bggSelectedGame.description_cn || bggSelectedGame.description || '',
```

---

## 三、前端 `server/public/js/pages/detail.js` 显示中文描述

找到显示描述的位置（`game.description`），改为：

```js
var desc = game.description_cn || game.description || '';
```

---

## 四、验证

Push后，从BGG导入一个游戏，看C端详情页描述是否为中文。
