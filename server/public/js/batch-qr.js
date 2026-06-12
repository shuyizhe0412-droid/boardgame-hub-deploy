// ============ 批量二维码（带多选 + Canvas下载）============

let batchQrGames = [];
let batchQrCurrentPage = 1;
const batchQrPageSize = 6;
let batchQrInitialized = false;
let batchQrSelected = new Set(); // 存储选中的游戏ID

async function drawQRCard({ gameName, players, duration, qrDataUrl }) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const cardW = 300;
  const cardH = 400;
  const padding = 20;
  const qrSize = 200;

  canvas.width = cardW;
  canvas.height = cardH;

  // 背景
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, 0, 0, cardW, cardH, 16);
  ctx.fill();

  // 顶部色条
  ctx.fillStyle = '#1b4332';
  roundRectTop(ctx, 0, 0, cardW, 8, 16);
  ctx.fill();

  // 二维码
  try {
    const qrImg = await loadImage(qrDataUrl);
    const qrX = (cardW - qrSize) / 2;
    ctx.drawImage(qrImg, qrX, padding, qrSize, qrSize);

    // 二维码边框
    ctx.strokeStyle = '#e8e2d8';
    ctx.lineWidth = 1;
    roundRect(ctx, qrX, padding, qrSize, qrSize, 8);
    ctx.stroke();
  } catch (e) {
    ctx.fillStyle = '#f0f0f0';
    roundRect(ctx, (cardW - qrSize) / 2, padding, qrSize, qrSize, 8);
    ctx.fill();
  }

  // 游戏名称
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 18px Syne, sans-serif';
  const nameLines = wrapText(ctx, gameName, cardW - padding * 2);
  nameLines.forEach((line, i) => {
    ctx.fillText(line, padding, padding + qrSize + 30 + i * 24);
  });

  // 元信息
  const meta = [players, duration].filter(Boolean).join('  |  ');
  if (meta) {
    ctx.fillStyle = '#64748b';
    ctx.font = '13px Source Serif 4, serif';
    ctx.fillText(meta, padding, padding + qrSize + 30 + nameLines.length * 24 + 10);
  }

  // 底部标签
  ctx.fillStyle = '#faf8f4';
  ctx.font = '11px sans-serif';
  ctx.fillText('BoardGame Hub', padding, cardH - padding);

  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), 'image/png');
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function roundRectTop(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  if (text.length <= 10) return [text];
  const words = text.split('');
  const lines = [];
  let line = '';
  for (const char of words) {
    const test = line + char;
    if (ctx.measureText(test).width > maxWidth) {
      if (line) lines.push(line);
      line = char;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 2); // 最多2行
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ================================================
// 2. 初始化 + 事件绑定
// ================================================
function initBatchQr() {
  if (batchQrInitialized) return;
  batchQrInitialized = true;

  const modal = document.getElementById('batch-qr-modal');
  const closeBtn = document.getElementById('batch-qr-close-btn');
  const downloadAllBtn = document.getElementById('batch-qr-download-all');
  const batchQrBtn = document.getElementById('batch-qr-btn');
  const selectAllBtn = document.getElementById('batch-qr-select-all');
  const deselectAllBtn = document.getElementById('batch-qr-deselect-all');
  const downloadSelectedBtn = document.getElementById('batch-qr-download-selected');

  if (!modal || !closeBtn || !downloadAllBtn || !batchQrBtn) return;

  batchQrBtn.addEventListener('click', openBatchQrModal);
  closeBtn.addEventListener('click', closeBatchQrModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeBatchQrModal(); });
  downloadAllBtn.addEventListener('click', downloadAllQrCodes);

  if (selectAllBtn) selectAllBtn.addEventListener('click', () => {
    if (selectAllBtn.checked) {
      selectAllOnPage();
    } else {
      batchQrSelected.clear();
      document.querySelectorAll('.batch-qr-check').forEach(cb => { cb.checked = false; cb.closest('.batch-qr-card')?.classList.remove('selected'); });
      updateSelectedCount();
    }
  });
  if (deselectAllBtn) deselectAllBtn.addEventListener('click', deselectAllOnPage);
  if (downloadSelectedBtn) downloadSelectedBtn.addEventListener('click', downloadSelectedQrCodes);
}

// ================================================
// 3. 打开弹窗，加载游戏列表
// ================================================
async function openBatchQrModal() {
  const modal = document.getElementById('batch-qr-modal');
  if (!modal) return;

  try {
    batchQrGames = await apiFetch('/games');
    batchQrCurrentPage = 1;
    batchQrSelected = new Set();
    updateSelectedCount();
    renderBatchQrPage();
    modal.style.display = '';
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function closeBatchQrModal() {
  const modal = document.getElementById('batch-qr-modal');
  if (modal) modal.style.display = 'none';
}

// ================================================
// 4. 渲染当前页
// ================================================
function renderBatchQrPage() {
  const grid = document.getElementById('batch-qr-grid');
  const pagination = document.getElementById('batch-qr-pagination');
  if (!grid) return;

  const totalPages = Math.ceil(batchQrGames.length / batchQrPageSize);
  const start = (batchQrCurrentPage - 1) * batchQrPageSize;
  const end = start + batchQrPageSize;
  const pageGames = batchQrGames.slice(start, end);
  const shopId = currentUser && currentUser.id ? currentUser.id : '';

  grid.innerHTML = pageGames.map(g => {
    const gameUrl = 'https://boardgame-hub-deploy.pages.dev/app.html#/chat?gameId=' + g.id + '&shop=' + shopId + '&mode=rules';
    const qrApi = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(gameUrl);
    const players = (g.min_players && g.max_players) ? g.min_players + '-' + g.max_players + '人' : '';
    const duration = g.duration ? g.duration + '分钟' : '';
    const isSelected = batchQrSelected.has(g.id);

    return '<div class="batch-qr-card' + (isSelected ? ' selected' : '') + '">' +
      '<label class="batch-qr-check-label">' +
      '<input type="checkbox" class="batch-qr-check" data-id="' + g.id + '"' + (isSelected ? ' checked' : '') + '>' +
      '</label>' +
      '<img src="' + qrApi + '" alt="' + g.name + '">' +
      '<div class="game-name">' + g.name + '</div>' +
      '<div class="game-meta">' + players + ' ' + duration + '</div>' +
      '<button class="btn btn-outline btn-download-single" data-id="' + g.id + '" data-name="' + g.name + '">下载</button>' +
      '</div>';
  }).join('');

  // 分页控件
  if (pagination) {
    const prevDisabled = batchQrCurrentPage <= 1 ? 'disabled' : '';
    const nextDisabled = batchQrCurrentPage >= totalPages ? 'disabled' : '';
    pagination.innerHTML = '' +
      '<button class="btn btn-ghost btn-sm" id="batch-qr-prev" ' + prevDisabled + '>上一页</button>' +
      '<span class="page-info">第 ' + batchQrCurrentPage + ' / ' + totalPages + ' 页（共' + batchQrGames.length + '个）</span>' +
      '<button class="btn btn-ghost btn-sm" id="batch-qr-next" ' + nextDisabled + '>下一页</button>';

    document.getElementById('batch-qr-prev')?.addEventListener('click', () => {
      if (batchQrCurrentPage > 1) { batchQrCurrentPage--; renderBatchQrPage(); }
    });
    document.getElementById('batch-qr-next')?.addEventListener('click', () => {
      if (batchQrCurrentPage < totalPages) { batchQrCurrentPage++; renderBatchQrPage(); }
    });
  }

  // 复选框事件
  grid.querySelectorAll('.batch-qr-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.getAttribute('data-id');
      if (cb.checked) {
        batchQrSelected.add(id);
        cb.closest('.batch-qr-card').classList.add('selected');
      } else {
        batchQrSelected.delete(id);
        cb.closest('.batch-qr-card').classList.remove('selected');
      }
      updateSelectedCount();
    });
  });

  // 单个下载按钮事件
  grid.querySelectorAll('.btn-download-single').forEach(btn => {
    btn.addEventListener('click', () => {
      const gameId = btn.getAttribute('data-id');
      const gameName = btn.getAttribute('data-name');
      downloadSingleQr(gameId, gameName);
    });
  });
}

// ================================================
// 5. 多选操作
// ================================================
function selectAllOnPage() {
  const totalPages = Math.ceil(batchQrGames.length / batchQrPageSize);
  const start = (batchQrCurrentPage - 1) * batchQrPageSize;
  const end = start + batchQrPageSize;
  batchQrGames.slice(start, end).forEach(g => batchQrSelected.add(g.id));
  document.querySelectorAll('.batch-qr-check').forEach(cb => { cb.checked = true; cb.closest('.batch-qr-card')?.classList.add('selected'); });
  updateSelectedCount();
}

function deselectAllOnPage() {
  const start = (batchQrCurrentPage - 1) * batchQrPageSize;
  const end = start + batchQrPageSize;
  batchQrGames.slice(start, end).forEach(g => {
    batchQrSelected.delete(g.id);
    const card = document.querySelector('.batch-qr-card:has(.batch-qr-check[data-id="' + g.id + '"])');
    if (card) { card.classList.remove('selected'); }
  });
  document.querySelectorAll('.batch-qr-check').forEach(cb => { cb.checked = false; });
  batchQrSelected.clear();
  updateSelectedCount();
}

function updateSelectedCount() {
  const badge = document.getElementById('batch-qr-selected-count');
  const btn = document.getElementById('batch-qr-download-selected');
  if (badge) badge.textContent = batchQrSelected.size;
  if (btn) {
    btn.disabled = batchQrSelected.size === 0;
    btn.textContent = '下载选中 (' + batchQrSelected.size + ')';
  }
}

// ================================================
// 6. 下载逻辑
// ================================================
async function downloadAllQrCodes() {
  if (batchQrGames.length === 0) { showToast('没有可下载的二维码', 'error'); return; }
  showToast('正在打包下载，请稍候...', 'success');

  try {
    await ensureLibs();
    const zip = new JSZip();
    const shopId = currentUser && currentUser.id ? currentUser.id : '';
    const storeName = currentUser && currentUser.store_name ? currentUser.store_name : '店家';

    for (const g of batchQrGames) {
      const cardBlob = await fetchCardBlob(g, shopId);
      if (cardBlob) zip.file(g.name + '.png', cardBlob);
    }

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, '桌游二维码_' + storeName + '.zip');
    showToast('下载完成');
  } catch (err) {
    showToast('打包失败: ' + err.message, 'error');
  }
}

async function downloadSelectedQrCodes() {
  if (batchQrSelected.size === 0) { showToast('请先选择要下载的桌游', 'error'); return; }
  showToast('正在打包下载，请稍候...', 'success');

  try {
    await ensureLibs();
    const zip = new JSZip();
    const shopId = currentUser && currentUser.id ? currentUser.id : '';
    const storeName = currentUser && currentUser.store_name ? currentUser.store_name : '店家';
    let count = 0;

    for (const g of batchQrGames) {
      if (batchQrSelected.has(g.id)) {
        const cardBlob = await fetchCardBlob(g, shopId);
        if (cardBlob) { zip.file(g.name + '.png', cardBlob); count++; }
      }
    }

    if (count === 0) { showToast('未能下载任何二维码', 'error'); return; }

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, '桌游二维码_' + storeName + '_精选' + count + '张.zip');
    showToast('下载完成（共' + count + '张）');
  } catch (err) {
    showToast('打包失败: ' + err.message, 'error');
  }
}

async function downloadSingleQr(gameId, gameName) {
  const g = batchQrGames.find(x => x.id === gameId);
  if (!g) return;
  const shopId = currentUser && currentUser.id ? currentUser.id : '';

  showToast('正在生成卡片...', 'success');
  try {
    await ensureLibs();
    const blob = await fetchCardBlob(g, shopId);
    if (blob) saveAs(blob, g.name + '_卡片.png');
  } catch (err) {
    showToast('生成失败: ' + err.message, 'error');
  }
}

// ================================================
// 7. 辅助函数
// ================================================
async function fetchCardBlob(g, shopId) {
  const gameUrl = 'https://boardgame-hub-deploy.pages.dev/app.html#/chat?gameId=' + g.id + '&shop=' + shopId + '&mode=rules';
  const qrApi = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(gameUrl);
  const qrDataUrl = await fetchAsDataUrl(qrApi);
  const players = (g.min_players && g.max_players) ? g.min_players + '-' + g.max_players + '人' : '';
  const duration = g.duration ? g.duration + '分钟' : '';
  return drawQRCard({ gameName: g.name, players, duration, qrDataUrl });
}

async function fetchAsDataUrl(url) {
  const resp = await fetch(url);
  const blob = await resp.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function ensureLibs() {
  if (typeof JSZip === 'undefined') await loadScript('https://cdn.jsdelivr.net/npm/jszip@3/dist/jszip.min.js');
  if (typeof saveAs === 'undefined') await loadScript('https://cdn.jsdelivr.net/npm/file-saver@2/dist/FileSaver.min.js');
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ================================================
// 8. 初始化
// ================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBatchQr);
} else {
  initBatchQr();
}
