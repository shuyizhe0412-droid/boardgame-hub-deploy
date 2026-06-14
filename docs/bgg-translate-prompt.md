# BGG游戏名汉化翻译

## 任务

为 BGG 导入功能添加中文翻译：热门列表自动翻译游戏名，导入时翻译名称和描述。

---

## 一、在 `server/routes/bgg.js` 添加翻译函数

在 `module.exports = router;` **之前**，添加以下代码：

```js
// ========== 游戏名翻译 ==========
const https = require('https');

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
```

**修改热门端点**，把 `res.json(results)` 改为：

```js
const translated = await translateGameNames(results);
res.json(translated);
```

同样**修改搜索端点**，把 `res.json(results)` 改为：

```js
const translated = await translateGameNames(results);
res.json(translated);
```

---

## 二、前端 `server/public/js/app.js` 修改

**在 `selectBggGame` 函数中**，游戏详情显示时优先用中文名。

找到显示游戏名的位置 (`<h4>` + game.name)，改为：

```js
var displayName = game.name_cn || game.name;
```

**在热门列表 `loadHotGames` 和搜索结果 `searchBgg` 中**，优先显示中文名：

```js
var name = g.name_cn || g.name;
```

**在 `importFromBgg` 中**，导入时用中文名：

```js
game_name: bggSelectedGame.name_cn || bggSelectedGame.name,
```

---

## 三、验证

1. Push部署
2. 打开B端 → 从BGG导入
3. 热门列表应显示中文名（如"康考迪亚：特别版"而非"Concordia: Special Edition"）
4. 导入的游戏名应为中文
