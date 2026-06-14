var API = 'https://boardgame-hub-staging.onrender.com/api';

let currentUser = null;
let currentToken = null;
let currentGameId = null;
let currentKeyword = '';
let currentCategory = '';

function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ============ 工具函数 ============

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function showToast(msg, type = 'success') {
 const toast = $('#toast');
 toast.textContent = msg;
 toast.className = `toast ${type} show`;
 setTimeout(() => toast.classList.remove('show'), 3000);
}

async function apiFetch(path, options = {}) {
 const headers = { ...options.headers };
 const token = currentToken || localStorage.getItem('admin_token');
 if (token) headers['Authorization'] = `Bearer ${token}`;
 if (!(options.body instanceof FormData)) {
 headers['Content-Type'] = 'application/json';
 if (options.body && typeof options.body === 'object') {
 options.body = JSON.stringify(options.body);
 }
 }
 const res = await fetch(`${API}${path}`, { ...options, headers });
 const data = await res.json();
 if (!res.ok) throw new Error(data.error || '请求失败');
 return data;
}

function showPage(id) {
 $$('.page').forEach(p => p.style.display = 'none');
 $(`#${id}`).style.display = '';
}

// ============ 登录/注册 ============

function initAuth() {
 $$('.auth-tab').forEach(tab => {
 tab.addEventListener('click', () => {
 $$('.auth-tab').forEach(t => t.classList.remove('active'));
 tab.classList.add('active');
 const which = tab.dataset.tab;
 $('#login-form').style.display = which === 'login' ? '' : 'none';
 $('#register-form').style.display = which === 'register' ? '' : 'none';
 });
 });

 $('#login-form').addEventListener('submit', async (e) => {
 e.preventDefault();
 try {
 const data = await apiFetch('/auth/login', {
 method: 'POST',
 body: {
 email: $('#login-email').value,
 password: $('#login-password').value
 }
 });
 currentToken = data.token;
 currentUser = data.store;
 localStorage.setItem('admin_token', currentToken);
 localStorage.setItem('user', JSON.stringify(currentUser));
 showToast('登录成功');
 enterDashboard();
 } catch (err) {
 showToast(err.message, 'error');
 }
 });

 $('#register-form').addEventListener('submit', async (e) => {
 e.preventDefault();
 try {
 const data = await apiFetch('/auth/register', {
 method: 'POST',
 body: {
 email: $('#reg-email').value,
 password: $('#reg-password').value,
 store_name: $('#reg-store-name').value || undefined
 }
 });
 currentToken = data.token;
 currentUser = data.store;
 localStorage.setItem('admin_token', currentToken);
 localStorage.setItem('user', JSON.stringify(currentUser));
 showToast('注册成功');
 enterDashboard();
 } catch (err) {
 showToast(err.message, 'error');
 }
 });
}

// ============ 首页/桌游列表 ============

function enterDashboard() {
 showPage('dashboard-page');
 $('#store-name-display').textContent = currentUser.store_name || currentUser.email;
 loadGames();
}

async function loadGames() {
 try {
   let url = '/games';
  const params = [];
  if (currentKeyword) params.push('keyword=' + encodeURIComponent(currentKeyword));
  if (currentCategory) params.push('category=' + encodeURIComponent(currentCategory));
  if (params.length) url += '?' + params.join('&');
  const games = await apiFetch(url);
 renderGameGrid(games);
 } catch (err) {
 if (err.message.includes('登录') || err.message.includes('过期')) {
 logout();
 } else {
 showToast(err.message, 'error');
 }
 }
}

function renderGameGrid(games) {
 const grid = $('#game-grid');
 const empty = $('#empty-state');
 const count = $('#game-count');

 count.textContent = games.length;

 if (games.length === 0) {
 grid.innerHTML = '';
 empty.style.display = '';
 return;
 }

 empty.style.display = 'none';
 grid.innerHTML = games.map(g => {
 const sourceLabel = g.source === 'default'
 ? '<span class="tag tag-default">[默认]</span>'
 : '<span class="tag tag-custom">[自定义]</span>';

 return `
 <div class="game-card" data-id="${g.id}">
 <div class="card-cover">
 ${g.cover_image
 ? `<img src="${g.cover_image}" alt="${g.name}">`
 : '🎲'}
 </div>
 <div class="card-body">
 <div class="card-title">
 ${g.name}
 ${sourceLabel}
 </div>
 <div class="card-meta">
 ${g.min_players && g.max_players
 ? `<span>👥 ${g.min_players}-${g.max_players}人</span>`
 : ''}
 ${g.duration
 ? `<span>⏱️ ${g.duration}分钟</span>`
 : ''}
 </div>
 </div>
 </div>
 `;
 }).join('');

 grid.querySelectorAll('.game-card').forEach(card => {
 card.addEventListener('click', () => openGameDetail(card.dataset.id));
 });
}

// ============ 桌游详情 ============

async function openGameDetail(gameId) {
 currentGameId = gameId;
 showPage('detail-page');
 try {
 const data = await apiFetch(`/games/${gameId}`);
 renderGameDetail(data.game);
 } catch (err) {
 showToast(err.message, 'error');
 showPage('dashboard-page');
 }
}

function renderGameDetail(game) {
 $('#detail-header-title').textContent = game.name;
 $('#detail-name').textContent = game.name;

 // 封面
  const cover = $('#detail-cover');
  if (game.cover_image) {
    cover.innerHTML = `<img src="${game.cover_image}" alt="${game.name}">`;
    $('#restore-cover-btn').style.display = '';
  } else {
    cover.innerHTML = '<span class="cover-placeholder">🎲</span>';
    $('#restore-cover-btn').style.display = 'none';
  }

// 基本信息
 const players = game.min_players && game.max_players
 ? `${game.min_players}-${game.max_players} 人` : '未设置';
 const duration = game.duration ? `${game.duration} 分钟` : '未设置';
 const diff = game.difficulty || 3;
 const diffStars = '★'.repeat(diff) + '☆'.repeat(5 - diff);

 $('#detail-players').textContent = players;
 $('#detail-duration').textContent = duration;
 $('#detail-difficulty').textContent = diffStars;

 // 标签
 const tagsEl = $('#detail-tags');
 if (game.tags) {
 const tags = typeof game.tags === 'string' ? game.tags.split(',') : game.tags;
 tagsEl.innerHTML = tags.map(t => `<span class="tag">${t.trim()}</span>`).join('');
 } else {
 tagsEl.innerHTML = '';
 }

 // 规则书文件
 loadGameFiles(game.id);

 // 规则书智能解析段落
 loadRuleSections(game.id);

 // 二维码 — 指向玩家端 AI 教学页
 const playerBase = 'https://boardgame-hub-deploy.pages.dev/app.html';
 const shopId = game.store_id || currentUser.id;
 const playUrl = `${playerBase}/#/chat?gameId=${game.id}&shop=${shopId}`;
 const qrApi = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(playUrl)}`;
 $('#qr-code').innerHTML = `<img src="${qrApi}" alt="QR Code">`;
}

async function loadGameFiles(gameId) {
 const filesEl = $('#detail-files');
 try {
 const files = await apiFetch(`/upload/${gameId}`);
 if (!files || files.length === 0) {
 filesEl.innerHTML = '<p class="text-muted">暂无规则书文件</p>';
 return;
 }
 filesEl.innerHTML = files.map(f => `
 <div class="file-item">
 <span>${f.file_type === 'pdf' ? '📄' : '🖼️'} ${f.file_type.toUpperCase()} 文件</span>
 <a href="${f.file_url}" target="_blank">查看</a>
 <button class="btn btn-sm btn-danger" onclick="deleteFile('${f.id}')">删除</button>
 </div>
 `).join('');
 } catch {
 filesEl.innerHTML = '<p class="text-muted">暂无规则书文件</p>';
 }
}


// ============ 删除规则书文件 ============

async function deleteFile(fileId) {
  if (!confirm('确定要删除这个文件吗？此操作不可撤销。')) return;
  try {
    await apiFetch(`/upload/${fileId}`, { method: 'DELETE' });
    showToast('删除成功');
    loadGameFiles(currentGameId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============ 规则书智能解析 ============

async function loadRuleSections(gameId) {
  var el = document.getElementById('detail-rule-sections');
  if (!el) return;
  try {
    var data = await apiFetch('/rules/' + encodeURIComponent(gameId));
    var sections = (data && data.sections) || [];
    if (sections.length === 0) {
      el.innerHTML = '<p class="text-muted">尚未上传规则书，点击「上传并解析」</p>';
      return;
    }
    var html = '<div class="rule-sections-count">已提取 <b>' + sections.length + '</b> 段规则' +
      ' <button class="btn btn-sm btn-outline-danger" onclick="clearAllRuleSections(\'' + gameId + '\')" style="margin-left:8px">🗑 清空全部</button></div>';
    html += '<div class="rule-sections-list-scroll">';
    sections.forEach(function(s) {
      html += '<div class="rule-section-item">' +
        '<div class="rule-section-item-header">' +
        '<span class="rule-section-badge">第' + s.page_number + '页</span>' +
        '<span class="rule-section-title">' + (s.section_title || '') + '</span>' +
        '<span class="rule-section-source">' + (s.source_type === 'image_ocr' ? '🖼️OCR' : s.source_type === 'pdf' ? '📄PDF' : '📝文本') + '</span>' +
        '<button class="btn btn-sm btn-danger rule-section-del-btn" onclick="deleteRuleSection(\'' + s.id + '\')">✕</button>' +
        '</div>' +
        '<div class="rule-section-content">' + (s.content || '').substring(0, 200) + ((s.content || '').length > 200 ? '...' : '') + '</div>' +
        '</div>';
    });
    html += '</div>';
    el.innerHTML = html;
  } catch (err) {
    el.innerHTML = '<p class="text-muted" style="color:#e74c3c">加载规则段落失败: ' + err.message + '</p>';
  }
}

async function triggerRulesUpload() {
  var input = document.getElementById('rules-file-input');
  if (!input) return;
  input.click();
}

async function handleRulesFileSelected(e) {
  var file = e.target.files[0];
  if (!file) return;
  if (!currentGameId) { showToast('请先选择游戏', 'error'); e.target.value = ''; return; }

  var el = document.getElementById('detail-rule-sections');
  if (el) el.innerHTML = '<p class="text-muted">⏳ 正在上传并解析规则书，请稍候...</p>';

  try {
    var fd = new FormData();
    fd.append('file', file);
    fd.append('game_id', currentGameId);

    var resp = await fetch(API + '/rules/upload', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + currentToken },
      body: fd
    });
    var data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '上传失败');

    showToast('✅ 成功提取 ' + data.sections + ' 段规则');
    loadRuleSections(currentGameId);
  } catch (err) {
    showToast('规则解析失败: ' + err.message, 'error');
    loadRuleSections(currentGameId);
  }
  e.target.value = '';
}

async function deleteRuleSection(sectionId) {
  if (!confirm('确定要删除这条规则段落吗？')) return;
  try {
    await apiFetch('/rules/section/' + encodeURIComponent(sectionId), { method: 'DELETE' });
    showToast('删除成功');
    loadRuleSections(currentGameId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function clearAllRuleSections(gameId) {
  if (!confirm('确定清空该游戏的全部规则段落吗？此操作不可撤销！')) return;
  try {
    await apiFetch('/rules/game/' + encodeURIComponent(gameId), { method: 'DELETE' });
    showToast('已清空全部规则段落');
    loadRuleSections(gameId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function initRulesUpload() {
  var btn = document.getElementById('upload-rules-btn');
  if (btn) btn.addEventListener('click', triggerRulesUpload);

  var input = document.getElementById('rules-file-input');
  if (input) input.addEventListener('change', handleRulesFileSelected);
}

// ============ 添加/编辑桌游弹窗 ============

let editingGameId = null;

function openGameModal(game = null) {
 editingGameId = game ? game.id : null;
 $('#modal-title').textContent = game ? '编辑桌游' : '添加桌游';
 $('#form-game-name').value = game?.name || '';
 $('#form-min-players').value = game?.min_players || '';
 $('#form-max-players').value = game?.max_players || '';
 $('#form-duration').value = game?.duration || '';
 $('#form-tags').value = game?.tags || '';
 $('#form-cover').value = '';
 $('#form-rulebook').value = '';

 const diff = game?.difficulty || 3;
 $$('#difficulty-stars .star').forEach(s => {
 s.classList.toggle('active', parseInt(s.dataset.value) <= diff);
 });

 $('#game-modal').style.display = '';
}

function closeGameModal() {
 $('#game-modal').style.display = 'none';
 editingGameId = null;
}

function initGameModal() {
 // 难度星星
 $$('#difficulty-stars .star').forEach(star => {
 star.addEventListener('click', () => {
 const val = parseInt(star.dataset.value);
 $$('#difficulty-stars .star').forEach(s => {
 s.classList.toggle('active', parseInt(s.dataset.value) <= val);
 });
 });
 });

 // 关闭弹窗
 $('#modal-close-btn').addEventListener('click', closeGameModal);
 $('#modal-cancel-btn').addEventListener('click', closeGameModal);
 $('#game-modal').addEventListener('click', (e) => {
 if (e.target === $('#game-modal')) closeGameModal();
 });

 // 添加按钮
 $('#add-game-btn').addEventListener('click', () => openGameModal());

 // 表单提交
 $('#game-form').addEventListener('submit', async (e) => {
 e.preventDefault();
 const submitBtn = $('#modal-submit-btn');
 submitBtn.disabled = true;
 submitBtn.textContent = '保存中...';

 try {
 const difficulty = $$('#difficulty-stars .star.active').length;

 const gameData = {
 name: $('#form-game-name').value,
 min_players: parseInt($('#form-min-players').value) || null,
 max_players: parseInt($('#form-max-players').value) || null,
 duration: parseInt($('#form-duration').value) || null,
 difficulty: difficulty,
 tags: $('#form-tags').value || null
 };

 let gameId;
 if (editingGameId) {
 await apiFetch(`/games/${editingGameId}`, {
 method: 'PUT',
 body: gameData
 });
 gameId = editingGameId;
 } else {
 const result = await apiFetch('/games', {
 method: 'POST',
 body: gameData
 });
 gameId = result.game.id;
 }

 // 上传封面
 const coverFile = $('#form-cover').files[0];
 if (coverFile) {
 const fd = new FormData();
 fd.append('file', coverFile);
 fd.append('game_id', gameId);
 const res = await fetch(`${API}/upload/cover`, {
 method: 'POST',
 headers: { 'Authorization': `Bearer ${currentToken}` },
 body: fd
 });
 if (!res.ok) {
 const err = await res.json();
 console.warn('封面上传失败:', err.error);
 }
 }

 // 上传规则书
 const rulebookFile = $('#form-rulebook').files[0];
 if (rulebookFile) {
 const fd = new FormData();
 fd.append('file', rulebookFile);
 fd.append('game_id', gameId);
 const res = await fetch(`${API}/upload`, {
 method: 'POST',
 headers: { 'Authorization': `Bearer ${currentToken}` },
 body: fd
 });
 if (!res.ok) {
 const err = await res.json();
 console.warn('规则书上传失败:', err.error);
 }
 }

 showToast(editingGameId ? '更新成功' : '添加成功');
 closeGameModal();
 loadGames();
 } catch (err) {
 showToast(err.message, 'error');
 } finally {
 submitBtn.disabled = false;
 submitBtn.textContent = '保存';
 }
 });
}

// ============ 封面上传 ============

function initCoverUpload() {
  // 封面上传
 $('#upload-cover-btn').addEventListener('click', () => {
 $('#cover-file-input').click();
 });
 $('#cover-file-input').addEventListener('change', async (e) => {
 const file = e.target.files[0];
 if (!file) return;
 try {
 const fd = new FormData();
 fd.append('file', file);
 fd.append('game_id', currentGameId);
 const res = await fetch(`${API}/upload/cover`, {
 method: 'POST',
 headers: { 'Authorization': `Bearer ${currentToken}` },
 body: fd
 });
 if (!res.ok) { throw new Error((await res.json()).error); }
 const data = await res.json();
 const coverUrl = data.file && data.file.url ? data.file.url : null;
 if (coverUrl) {
 // 用相对路径时拼接 origin
 const finalUrl = coverUrl.startsWith('http') ? coverUrl : window.location.origin + coverUrl;
 await apiFetch(`/games/${currentGameId}`, {
 method: 'PUT',
 body: JSON.stringify({ cover_image: finalUrl })
 });
 }
 showToast('封面更新成功');
 openGameDetail(currentGameId);
 } catch (err) {
 showToast(err.message || '封面上传失败', 'error');
 }
 // 清空 input，允许重新选择同一文件
 e.target.value = '';
 });

  // 还原默认封面按钮
  $('#restore-cover-btn').addEventListener('click', restoreCover);
}


// ============ 还原默认封面 ============

async function restoreCover() {
  if (!confirm('确定要还原为默认封面吗？')) return;
  try {
    await apiFetch(`/games/${currentGameId}`, {
      method: 'PUT',
      body: JSON.stringify({ cover_image: '' })
    });
    showToast('已还原为默认封面');
    openGameDetail(currentGameId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============ 删除桌游 ============

function initDelete() {
 $('#delete-game-btn').addEventListener('click', async () => {
 if (!confirm('确定要删除这个桌游吗？此操作不可撤销。')) return;
 try {
 await apiFetch(`/games/${currentGameId}`, { method: 'DELETE' });
 showToast('删除成功');
 showPage('dashboard-page');
 loadGames();
 } catch (err) {
 showToast(err.message, 'error');
 }
 });
}

// ============ 导航 ============

function initNavigation() {
 $('#back-btn').addEventListener('click', () => {
 showPage('dashboard-page');
 loadGames();
 });

 $('#logout-btn').addEventListener('click', logout);

  $('#view-player-btn').addEventListener('click', () => {
    var playerUrl = 'https://boardgame-hub-deploy.pages.dev/app.html#/home?shop=' + (currentUser ? currentUser.id : '');
      window.open(playerUrl, '_blank');
  });
}

function logout() {
 currentToken = null;
 currentUser = null;
 localStorage.removeItem('admin_token');
 localStorage.removeItem('user');
 showPage('auth-page');
}


// ===== 规则编辑弹窗 =====

function openRulesModal() {
  document.body.style.overflow = 'hidden';
  loadRuleSectionsForEditor();
  $('#rules-modal').style.display = '';
}

function closeRulesModal() {
  document.body.style.overflow = '';
  $('#rules-modal').style.display = 'none';
}

async function loadRuleSectionsForEditor() {
  var el = document.getElementById('rule-sections-editor');
  if (!el) return;
  el.innerHTML = '<p class="text-muted">加载中...</p>';
  
  try {
    var data = await apiFetch('/rules/' + encodeURIComponent(currentGameId));
    var sections = (data && data.sections) || [];
    
    if (sections.length === 0) {
      el.innerHTML = '<p class="text-muted">暂无规则段落，请先上传规则书</p>';
      return;
    }
    
    var html = '';
    sections.forEach(function(s, idx) {
      html += '<div class="rule-editor-item" data-section-id="' + s.id + '">' +
        '<div class="rule-editor-header">' +
        '<span class="rule-editor-index">#' + (idx + 1) + '</span>' +
        '<label>页码:</label>' +
        '<input type="number" class="rule-editor-page" value="' + s.page_number + '" min="1" style="width:60px">' +
        '<label>标题:</label>' +
        '<input type="text" class="rule-editor-title" value="' + (s.section_title || '').replace(/"/g, '&quot;') + '" style="flex:1">' +
        '<button class="btn btn-sm btn-danger rule-editor-del" onclick="deleteRuleSection(\'' + s.id + '\')">✕</button>' +
        '</div>' +
        '<textarea class="rule-editor-content" rows="4">' + (s.content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</textarea>' +
        '</div>';
    });
    el.innerHTML = html;
  } catch (err) {
    el.innerHTML = '<p class="text-muted" style="color:#e74c3c">加载失败: ' + err.message + '</p>';
  }
}

async function saveRuleSection(sectionId, pageNum, title, content) {
  return await apiFetch('/rules/section/' + encodeURIComponent(sectionId), {
    method: 'PATCH',
    body: { page_number: pageNum, section_title: title, content: content }
  });
}

function initRulesModal() {
  $('#edit-rules-btn').addEventListener('click', () => {
    openRulesModal();
  });

  $('#rules-modal-close-btn').addEventListener('click', closeRulesModal);
  $('#rules-modal-cancel-btn').addEventListener('click', closeRulesModal);
  $('#rules-modal').addEventListener('click', (e) => {
    if (e.target === $('#rules-modal')) closeRulesModal();
  });

  $('#rules-modal-save-btn').addEventListener('click', async () => {
    var items = document.querySelectorAll('.rule-editor-item');
    if (items.length === 0) {
      showToast('没有可保存的段落', 'error');
      return;
    }
    
    var saveBtn = $('#rules-modal-save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中...';
    
    var saved = 0;
    var failed = 0;
    
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var sectionId = item.getAttribute('data-section-id');
      var pageNum = parseInt(item.querySelector('.rule-editor-page').value) || 1;
      var title = item.querySelector('.rule-editor-title').value.trim();
      var content = item.querySelector('.rule-editor-content').value.trim();
      
      try {
        await saveRuleSection(sectionId, pageNum, title, content);
        saved++;
      } catch (err) {
        failed++;
        console.error('保存段落失败:', sectionId, err);
      }
    }
    
    saveBtn.disabled = false;
    saveBtn.textContent = '保存全部';
    
    if (failed === 0) {
      showToast('✅ 已保存 ' + saved + ' 段规则');
      closeRulesModal();
      loadRuleSections(currentGameId);
    } else {
      showToast('保存 ' + saved + ' 段，' + failed + ' 段失败', 'error');
    }
  });
}

// ============ 搜索与筛选 ============

// ============ 搜索与筛选 ============
function initSearchAndFilter() {
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');
  const filterTags = document.getElementById('filter-tags');

  if (searchInput) {
    searchInput.addEventListener('input', debounce(() => {
      currentKeyword = searchInput.value.trim();
      searchClear.style.display = currentKeyword ? '' : 'none';
      loadGames();
    }, 300));
  }

  if (searchClear) {
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      currentKeyword = '';
      searchClear.style.display = 'none';
      loadGames();
    });
  }

  if (filterTags) {
    filterTags.addEventListener('click', (e) => {
      const tag = e.target.closest('.filter-tag');
      if (!tag) return;
      filterTags.querySelectorAll('.filter-tag').forEach(t => t.classList.remove('active'));
      tag.classList.add('active');
      currentCategory = tag.dataset.category || '';
      loadGames();
    });
  }
}

// ============ 批量从游戏库添加 ============

var libraryState = {
  allGames: [],
  filteredGames: [],
  selectedIds: {},
  existingNames: {},
  currentPage: 1,
  pageSize: 20,
  keyword: '',
  category: ''
};

function openBatchLibraryModal() {
  libraryState = {
    allGames: [],
    filteredGames: [],
    selectedIds: {},
    existingNames: {},
    currentPage: 1,
    pageSize: 20,
    keyword: '',
    category: ''
  };
  $('#batch-library-modal').style.display = '';
  $('#library-search-input').value = '';
  $$('#library-filter-tags .filter-tag').forEach(function (t) {
    t.classList.toggle('active', t.dataset.cat === '');
  });
  loadLibraryGames();
}

function closeBatchLibraryModal() {
  $('#batch-library-modal').style.display = 'none';
}

function loadLibraryGames() {
  $('#library-game-list').innerHTML = '<div class="loading-state"><div class="spinner"></div><p>加载中...</p></div>';

  // 加载全局游戏库
  apiFetch('/admin/global-games').then(function (games) {
    libraryState.allGames = games || [];

    // 加载店家已有的游戏名（用于去重标记）
    return apiFetch('/games');
  }).then(function (existing) {
    var names = {};
    (existing || []).forEach(function (g) { names[g.name] = true; });
    libraryState.existingNames = names;

    // 预选已存在的游戏（勾选但禁用）
    libraryState.allGames.forEach(function (g) {
      if (names[g.game_name]) {
        libraryState.selectedIds[g.id] = true;
      }
    });

    applyLibraryFilter();
  }).catch(function (err) {
    // 如果获取已有游戏失败，至少显示全局库
    if (libraryState.allGames.length > 0) {
      applyLibraryFilter();
    } else {
      showToast('加载游戏库失败: ' + err.message, 'error');
      closeBatchLibraryModal();
    }
  });
}

function applyLibraryFilter() {
  var keyword = libraryState.keyword.toLowerCase();
  var cat = libraryState.category;

  libraryState.filteredGames = libraryState.allGames.filter(function (g) {
    var name = (g.game_name || '').toLowerCase();
    var tags = (g.tags || '').toLowerCase();
    if (keyword && name.indexOf(keyword) === -1 && tags.indexOf(keyword) === -1) return false;
    if (cat && tags.indexOf(cat.toLowerCase()) === -1) return false;
    return true;
  });

  $('#library-total').textContent = libraryState.filteredGames.length;
  libraryState.currentPage = 1;
  renderLibraryPage();
}

function renderLibraryPage() {
  var start = (libraryState.currentPage - 1) * libraryState.pageSize;
  var end = start + libraryState.pageSize;
  var page = libraryState.filteredGames.slice(start, end);
  var totalPages = Math.ceil(libraryState.filteredGames.length / libraryState.pageSize) || 1;

  $('#library-game-list').innerHTML = page.map(function (g) {
    var isExisting = !!libraryState.existingNames[g.game_name];
    var isChecked = !!libraryState.selectedIds[g.id];
    var diff = g.difficulty || 2;
    var stars = '\u2605'.repeat(diff) + '\u2606'.repeat(5 - diff);

    return (
      '<div class="library-game-item' + (isChecked ? ' selected' : '') + (isExisting ? ' existing' : '') + '">' +
        '<label class="library-game-checkbox">' +
          '<input type="checkbox" data-id="' + g.id + '" ' + (isChecked ? 'checked' : '') + (isExisting ? ' disabled' : '') + '>' +
          '<span class="checkbox-custom"></span>' +
        '</label>' +
        '<div class="library-game-info">' +
          '<div class="library-game-name">' +
            escapeHtml(g.game_name) +
            (isExisting ? ' <span class="tag tag-default">已拥有</span>' : '') +
          '</div>' +
          '<div class="library-game-meta">' +
            '<span>\uD83D\uDC65 ' + (g.player_min || 2) + '-' + (g.player_max || 4) + '人</span>' +
            '<span>\u23F1 ' + (g.duration || 30) + '分钟</span>' +
            '<span>' + stars + '</span>' +
          '</div>' +
          '<div class="library-game-tags">' + (g.tags ? g.tags.split(',').map(function (t) { return '<span class="tag">' + escapeHtml(t.trim()) + '</span>'; }).join('') : '') + '</div>' +
          '<div class="library-game-desc">' + escapeHtml((g.description || '').slice(0, 200)) + '</div>' +
        '</div>' +
      '</div>'
    );
  }).join('');

  // 分页
  var pagHtml = '';
  if (totalPages > 1) {
    for (var p = 1; p <= totalPages; p++) {
      pagHtml += '<button class="page-btn' + (p === libraryState.currentPage ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
    }
  }
  $('#library-pagination').innerHTML = pagHtml;

  // 更新选中计数
  updateLibrarySelectedCount();
}

function updateLibrarySelectedCount() {
  var count = 0;
  var ids = Object.keys(libraryState.selectedIds);
  for (var i = 0; i < ids.length; i++) {
    if (libraryState.selectedIds[ids[i]]) count++;
  }
  $('#library-selected-count').textContent = count;
  $('#library-summary-count').textContent = count;
  if (count > 0) {
    $('#library-summary').style.display = '';
    $('#batch-library-confirm-btn').disabled = false;
  } else {
    $('#library-summary').style.display = 'none';
    $('#batch-library-confirm-btn').disabled = true;
  }
}

async function submitBatchLibrary() {
  var ids = [];
  var allIds = Object.keys(libraryState.selectedIds);
  for (var i = 0; i < allIds.length; i++) {
    if (libraryState.selectedIds[allIds[i]]) {
      ids.push(allIds[i]);
    }
  }

  // 去掉已存在的（后端也会去重，但前端先过滤减少请求）
  ids = ids.filter(function (id) {
    var game = libraryState.allGames.find(function (g) { return g.id === id; });
    return game && !libraryState.existingNames[game.game_name];
  });

  if (ids.length === 0) {
    showToast('没有新游戏需要添加', 'error');
    return;
  }

  var confirmBtn = $('#batch-library-confirm-btn');
  confirmBtn.disabled = true;
  confirmBtn.textContent = '添加中...';

  try {
    var result = await apiFetch('/games/batch-add', {
      method: 'POST',
      body: { game_ids: ids }
    });
    showToast('\u2705 成功添加 ' + result.added + ' 款游戏' + (result.skipped > 0 ? '，跳过 ' + result.skipped + ' 款已有' : ''));
    closeBatchLibraryModal();
    loadGames();
  } catch (err) {
    showToast(err.message, 'error');
    confirmBtn.disabled = false;
    confirmBtn.textContent = '添加到我的游戏';
  }
}

function initBatchLibraryModal() {
  // 打开弹窗
  $('#batch-library-btn').addEventListener('click', openBatchLibraryModal);
  // 空状态按钮
  var emptyBtn = $('#empty-add-btn');
  if (emptyBtn) {
    emptyBtn.addEventListener('click', openBatchLibraryModal);
  }

  // 关闭弹窗
  $('#batch-library-close-btn').addEventListener('click', closeBatchLibraryModal);
  $('#batch-library-cancel-btn').addEventListener('click', closeBatchLibraryModal);
  $('#batch-library-modal').addEventListener('click', function (e) {
    if (e.target === $('#batch-library-modal')) closeBatchLibraryModal();
  });

  // 搜索
  $('#library-search-input').addEventListener('input', debounce(function () {
    libraryState.keyword = $('#library-search-input').value.trim();
    applyLibraryFilter();
  }, 300));

  // 分类筛选
  $('#library-filter-tags').addEventListener('click', function (e) {
    var tag = e.target.closest('.filter-tag');
    if (!tag) return;
    $$('#library-filter-tags .filter-tag').forEach(function (t) { t.classList.remove('active'); });
    tag.classList.add('active');
    libraryState.category = tag.dataset.cat || '';
    applyLibraryFilter();
  });

  // 分页点击
  $('#library-pagination').addEventListener('click', function (e) {
    var btn = e.target.closest('.page-btn');
    if (!btn) return;
    libraryState.currentPage = parseInt(btn.dataset.page);
    renderLibraryPage();
  });

  // 复选框点击
  $('#library-game-list').addEventListener('change', function (e) {
    if (e.target.type !== 'checkbox') return;
    var id = e.target.dataset.id;
    var isExisting = e.target.disabled;
    if (isExisting) {
      e.target.checked = true; // 强制保持选中
      return;
    }
    libraryState.selectedIds[id] = e.target.checked;

    // 更新行样式
    var row = e.target.closest('.library-game-item');
    if (row) row.classList.toggle('selected', e.target.checked);

    updateLibrarySelectedCount();
  });

  // 确认添加
  $('#batch-library-confirm-btn').addEventListener('click', submitBatchLibrary);
}

// ============ 店铺入口二维码 ============

function openStoreQrModal() {
  var storeName = currentUser ? currentUser.store_name : '桌游吧';
  var storeId = currentUser ? currentUser.id : '';
  var url = 'https://boardgame-hub-deploy.pages.dev/app.html#/home?shop=' + storeId;
  var qrSrc = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(url);

  $('#store-qr-img').src = qrSrc;
  $('#store-qr-name').textContent = '扫描二维码进入「' + storeName + '」的桌游列表';
  $('#store-qr-modal').style.display = '';
}

function closeStoreQrModal() {
  $('#store-qr-modal').style.display = 'none';
}

async function downloadStoreQr() {
  var qrSrc = $('#store-qr-img').src;
  if (!qrSrc) {
    showToast('二维码尚未生成', 'error');
    return;
  }

  var storeName = currentUser ? currentUser.store_name : '桌游吧';
  var downloadBtn = $('#store-qr-download-btn');
  downloadBtn.disabled = true;
  downloadBtn.textContent = '下载中...';

  try {
    var resp = await fetch(qrSrc);
    var blob = await resp.blob();
    saveAs(blob, storeName + '_店铺入口码.png');
    showToast('下载完成');
  } catch (err) {
    showToast('下载失败: ' + err.message, 'error');
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.textContent = '📥 下载二维码';
  }
}

function initStoreQrModal() {
  $('#store-qr-btn').addEventListener('click', openStoreQrModal);

  $('#store-qr-close-btn').addEventListener('click', closeStoreQrModal);
  $('#store-qr-cancel-btn').addEventListener('click', closeStoreQrModal);
  $('#store-qr-modal').addEventListener('click', function (e) {
    if (e.target === $('#store-qr-modal')) closeStoreQrModal();
  });

  $('#store-qr-download-btn').addEventListener('click', downloadStoreQr);
}

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
  
  // 自动加载热门游戏
  loadHotGames();
}

async function loadHotGames() {
  var statusEl = document.getElementById('bgg-search-status');
  var resultsEl = document.getElementById('bgg-search-results');

  statusEl.textContent = '加载热门桌游...';
  resultsEl.innerHTML = '';

  try {
    var games = await apiFetch('/bgg/hot');
    statusEl.textContent = '热门桌游（也可搜索）';

    resultsEl.innerHTML = games.map(function(g) {
      var name = g.name_cn || g.name;
      return '<div class="bgg-result-item" onclick="selectBggGame(\'' + g.bggId + '\')">' +
        '<span class="bgg-result-rank">#' + g.rank + '</span>' +
        '<span class="bgg-result-name">' + escapeHtml(name) + '</span>' +
        (g.year ? '<span class="bgg-result-year">(' + g.year + ')</span>' : '') +
      '</div>';
    }).join('');
  } catch (err) {
    statusEl.textContent = '加载热门失败，请直接搜索';
  }
}

function closeBggModal() {
  document.getElementById('bgg-modal').style.display = 'none';
}

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
    var games = await apiFetch('/bgg/search?query=' + encodeURIComponent(query));
    if (!games || !games.length) {
      statusEl.textContent = '未找到游戏，换个关键词试试';
      searchBtn.disabled = false;
      return;
    }

    statusEl.textContent = '找到 ' + games.length + ' 个结果';
    resultsEl.innerHTML = games.map(function(g) {
      var name = g.name_cn || g.name;
      return '<div class="bgg-result-item" onclick="selectBggGame(\'' + g.bggId + '\')">' +
        '<span class="bgg-result-name">' + escapeHtml(name) + '</span>' +
        (g.year ? '<span class="bgg-result-year">(' + g.year + ')</span>' : '') +
      '</div>';
    }).join('');
  } catch (err) {
    statusEl.textContent = '搜索超时或失败，请重试';
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
    const game = await apiFetch('/bgg/game/' + bggId);
    bggSelectedGame = game;

    var displayName = game.name_cn || game.name;

    detailEl.innerHTML =
      '<div class="bgg-detail-header">' +
        (game.thumbnail ? '<img src="' + game.thumbnail + '" alt="' + escapeHtml(displayName) + '" class="bgg-detail-thumb">' : '') +
        '<div>' +
          '<h4>' + escapeHtml(displayName) + '</h4>' +
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
    // 翻译描述
    var descToUse = bggSelectedGame.description || '';
    if (descToUse && !/[\u4e00-\u9fff]/.test(descToUse)) {
      try {
        var transRes = await apiFetch('/bgg/translate-description', {
          method: 'POST',
          body: { text: descToUse.substring(0, 1500) }
        });
        descToUse = transRes.translated || descToUse;
      } catch (e) {
        // 翻译失败用原文
      }
    }

    const gameData = {
      name: bggSelectedGame.name_cn || bggSelectedGame.name,
      min_players: parseInt(bggSelectedGame.minPlayers) || 1,
      max_players: parseInt(bggSelectedGame.maxPlayers) || 4,
      duration: parseInt(bggSelectedGame.playingTime) || 60,
      difficulty: Math.round(parseFloat(bggSelectedGame.weight)) || 3,
      tags: (bggSelectedGame.categories || []).slice(0, 5).join(','),
      description: descToUse,
      bgg_id: bggSelectedGame.bggId,
      image_url: bggSelectedGame.image || '',
      thumb_url: bggSelectedGame.thumbnail || '',
      cover_image: bggSelectedGame.image || ''
    };

    await apiFetch('/games', {
      method: 'POST',
      body: gameData
    });

    showToast('游戏导入成功！');
    closeBggModal();
    loadGames();
  } catch (err) {
    showToast('导入失败: ' + err.message, 'error');
  } finally {
    importBtn.disabled = false;
    importBtn.textContent = '导入游戏';
  }
}

function initBggImport() {
  var openBtn = document.getElementById('bgg-import-open-btn');
  if (openBtn) openBtn.addEventListener('click', openBggModal);

  var closeBtn = document.getElementById('bgg-modal-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', closeBggModal);

  var cancelBtn = document.getElementById('bgg-cancel-btn');
  if (cancelBtn) cancelBtn.addEventListener('click', closeBggModal);

  var modal = document.getElementById('bgg-modal');
  if (modal) modal.addEventListener('click', function(e) {
    if (e.target === modal) closeBggModal();
  });
}

// ============ 初始化 ============

async function init() {
  initAuth();
  initGameModal();
  initCoverUpload();
  initDelete();
  initNavigation();

  initRulesModal();
  initSearchAndFilter();
  initBatchLibraryModal();
  initStoreQrModal();
  initRulesUpload();
  initBggImport();

  // 检查已登录状态
 currentToken = localStorage.getItem('admin_token');
 const savedUser = localStorage.getItem('user');
 if (currentToken && savedUser) {
 try {
 currentUser = JSON.parse(savedUser);
 const me = await apiFetch('/auth/me');
 currentUser = me.store || currentUser;
 enterDashboard();
 } catch {
 logout();
 }
 } else {
 showPage('auth-page');
 }

 $('#loading').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', init);
