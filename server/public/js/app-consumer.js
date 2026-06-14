/**
 * 桌游AI教练 - 应用入口模块
 * 负责页面挂载和路由初始化
 */

// 活跃页面守卫：防止快速切换Tab时旧页面异步回调覆盖当前页面
window._activePage = '';

// Tab 导航冷却：防止疯狂点击导致多次导航
var _lastNavTime = 0;

/**
 * 获取 TabBar HTML
 * 已登录店家：首页 / 游戏库 / AI / 我的
 * 未登录顾客：首页 / 游戏库 / AI / 关于
 * @param {string} activeTab - 当前激活的 Tab
 * @returns {string} TabBar HTML 字符串
 */
function getTabBarHtml(activeTab) {
    var loggedIn = window.isPlayerLoggedIn && window.isPlayerLoggedIn();

    var tabs = [
        { name: 'home', icon: '🏠', text: '首页' },
        { name: 'library', icon: '🎮', text: '游戏库' },
        { name: 'chat', icon: '🤖', text: 'AI' }
    ];

    // 始终显示「我的」标签，未登录时展示登录引导
    tabs.push({ name: 'profile', icon: '👤', text: '我的' });

    var items = tabs.map(function(tab) {
        var isActive = activeTab === tab.name ? 'active' : '';
        return '<div class="tabbar-item ' + isActive + '" data-page="' + tab.name + '">' +
            '<span class="tabbar-icon">' + tab.icon + '</span>' +
            '<span class="tabbar-text">' + tab.text + '</span>' +
            '</div>';
    }).join('');

    return '<nav class="tabbar">' + items + '</nav>';
}

// 绑定 TabBar 点击事件（含300ms冷却）
function bindTabBarEvents() {
    var items = document.querySelectorAll('.tabbar-item');
    console.log('[TabBar] 绑定事件, 找到元素数:', items.length);
    items.forEach(function(item) {
        item.addEventListener('click', function() {
            var now = Date.now();
            var page = this.dataset.page;
            console.log('[TabBar] 点击:', page, ', 冷却剩余:', Math.max(0, 300 - (now - _lastNavTime)), 'ms');
            if (now - _lastNavTime < 300) return;
            _lastNavTime = now;
            navigate('/' + page);
        });
    });
}

// 全局暴露，供页面重新渲染时使用
window.getTabBarHtml = getTabBarHtml;
window.bindTabBarEvents = bindTabBarEvents;
window.renderShopHeader = renderShopHeader;
window.getShopAppend = getShopAppend;

/**
 * 从URL中获取 shop 参数（支持 shop=xxx 和 shopId=xxx 两种 key）
 * @returns {string|null} shop UUID
 */
function getShopIdFromUrl() {
    var hash = window.location.hash || '';
    // 支持 shop=xxx 和 shopId=xxx 两种参数名
    var match = hash.match(/[?&]shop=([^&]+)/);
    if (!match) match = hash.match(/[?&]shopId=([^&]+)/);
    var shopId = match ? decodeURIComponent(match[1]) : null;
    console.log('[getShopIdFromUrl] shopId:', shopId, ', hash:', hash);
    return shopId;
}

/**
 * 加载店家信息并缓存到全局
 */
async function loadShopInfo() {
    var shopId = getShopIdFromUrl();
    if (!shopId) {
        shopId = sessionStorage.getItem('shopId');
    }
    if (!shopId) {
        window._shopInfo = null;
        return;
    }

    // 如果已经加载过且shopId相同，跳过
    if (window._shopInfo && window._shopInfo.id === shopId) return;

    sessionStorage.setItem('shopId', shopId);
    console.log('[app.js] 加载店家信息, shopId:', shopId, ', session已设置');

    try {
        var result = await window.getShopInfo(shopId);
        if (result.data) {
            window._shopInfo = result.data;
            console.log('[app.js] 店家信息加载成功:', result.data.name);
            console.log('[loadShopInfo] 完成, _shopInfo:', JSON.stringify(window._shopInfo));
        } else {
            window._shopInfo = null;
            console.warn('[app.js] 店家信息加载失败:', result.error);
        }
    } catch (e) {
        window._shopInfo = null;
        console.error('[app.js] 加载店家信息异常:', e);
    }
}

/**
 * 渲染店家专属顶部标题栏
 * @returns {string} HTML 字符串
 */
function renderShopHeader() {
    var shopInfo = window._shopInfo;
    if (!shopInfo) return '';

    var logoHtml = shopInfo.logo_url ?
        '<img src="' + shopInfo.logo_url + '" style="width:24px;height:24px;border-radius:50%;vertical-align:middle;margin-right:8px;object-fit:cover;" onerror="this.style.display=\'none\'">' :
        '';

    var bgColor = shopInfo.theme_color || '#C4864B';

    return '<div class="shop-header" style="background:' + bgColor + ';color:#fff;font-size:16px;font-weight:bold;' +
        'text-align:center;padding:12px 16px;line-height:24px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">' +
        logoHtml + (shopInfo.name || '桌游吧') +
        '</div>';
}

/**
 * 渲染页面内容
 * @param {string} pageName - 页面名称
 * @param {object} params - URL 参数对象
 * @param {string} [activeTab] - TabBar 高亮覆盖名（如 chat-list 页面高亮 chat 标签）
 */
function renderPageContent(pageName, params, activeTab) {
    // 活跃页面守卫：标记当前活跃页面，防止旧页面异步回调覆盖
    console.log('[Router] renderPageContent:', pageName, ', activeTab:', activeTab);
    window._activePage = pageName;

    var app = document.getElementById('app');
    if (!app) return;

    // 从 pages.js 注册的映射表中获取页面组件
    var page = window._pages[pageName];
    if (!page || typeof page.render !== 'function') {
        app.innerHTML = renderShopHeader() + '<div class="container"><h1>页面未找到: ' + pageName + '</h1></div>' + getTabBarHtml('home');
        return;
    }

    // 组合页面内容：全局店家标题栏 + 页面内容 + TabBar
    var content = page.render(params);
    var noTabBarPages = ['detail', 'chat'];
    var tabName = activeTab || pageName;
    var html = renderShopHeader() + content + (noTabBarPages.indexOf(pageName) === -1 ? getTabBarHtml(tabName) : '');
    app.innerHTML = html;

    // 绑定 TabBar 点击事件
    bindTabBarEvents();

    // 调用页面初始化方法
    if (typeof page.init === 'function') {
        page.init(params);
    }
}

/**
 * 认证守卫：检查是否需要跳转
 * @param {string} page - 页面名
 * @returns {boolean} 是否允许访问
 */
function authGuard(page) {
    var playerLoggedIn = window.isPlayerLoggedIn && window.isPlayerLoggedIn();

    // profile 页面：玩家未登录时显示"我的"Tab也可以进入（显示登录引导）
    // 不再强制跳转，profile 页内部会检测登录状态显示不同内容

    // auth 页面：已登录则跳转到 profile
    if (page === 'auth' && playerLoggedIn) {
        console.log('[app.js] 玩家已登录，跳转到个人中心');
        window.location.hash = '/profile';
        return false;
    }

    return true;
}

/**
 * 已登录时自动加载玩家信息
 */
async function loadPlayerInfo() {
    var loggedIn = window.isPlayerLoggedIn && window.isPlayerLoggedIn();
    if (!loggedIn) return;

    // 如果已经有缓存的玩家信息，先读取
    try {
        var cached = localStorage.getItem('player_info');
        if (cached) {
            window._playerInfo = JSON.parse(cached);
        }
    } catch (e) {
        window._playerInfo = null;
    }

    // 尝试从服务端刷新玩家信息
    try {
        var playerToken = window.getPlayerToken && window.getPlayerToken();
        if (!playerToken) return;

        var resp = await fetch(API_BASE_URL + '/auth/player-me', {
            headers: { 'Authorization': 'Bearer ' + playerToken }
        });
        if (resp.ok) {
            var data = await resp.json();
            if (data && data.id) {
                window._playerInfo = data;
                localStorage.setItem('player_info', JSON.stringify(data));
                console.log('[app.js] 玩家信息加载成功:', data.nickname);
            }
        }
    } catch (e) {
        console.warn('[app.js] 加载玩家信息失败:', e.message);
    }
}

/**
 * 初始化应用
 */
async function initApp() {
    // 初始化路由
    initRouter();

    // 先加载店家信息（从URL shop参数）
    await loadShopInfo();

    // 已登录玩家自动加载信息
    await loadPlayerInfo();

    // 路由到页面名的映射（/chat 无任何参数时映射到入口页）
    function resolvePage(route, params) {
        if (route === 'chat' && !params.id && !params.gameId && !params.mode) {
            return 'chat-list';
        }
        return route;
    }

    // 全局跳转辅助：从首页跳转到详情页时记录来源（供chat页返回使用）
    window.navigateToDetail = function(id, category) {
        if (id) {
            sessionStorage.setItem('chatFrom', '/detail?id=' + id);
        }
        if (category) {
            var recent = localStorage.getItem('recentCategories') || '';
            var cats = recent ? recent.split(',').filter(function(c) { return c !== category; }) : [];
            cats.unshift(category);
            localStorage.setItem('recentCategories', cats.slice(0, 5).join(','));
        }
        // 带上 shop 参数（如果有）
        var shopAppend = getShopAppend();
        window.location.hash = '/detail?id=' + encodeURIComponent(id) + shopAppend;
    };

    // 监听路由变化，渲染页面
    window.addEventListener('routechange', function(e) {
        var page = resolvePage(e.detail.page, e.detail.params);
        console.log('[Router] routechange:', e.detail.page, '→', page, ', hash:', window.location.hash);
        var currentHash = window.location.hash;

        // Bug 4 修复：进入 detail/chat 页面前保存来源页
        if (page === 'detail' || page === 'chat') {
            var prevPage = sessionStorage.getItem('currentMainPage') || '/home';
            sessionStorage.setItem('prevPageBeforeDetail', prevPage);
        } else {
            // 记录当前页作为"主页"（用于从 detail 返回）
            var hashWithoutParams = currentHash.split('?')[0];
            sessionStorage.setItem('currentMainPage', hashWithoutParams);
        }

        // 认证守卫
        if (!authGuard(page)) return;

        // 路由变化时也检查 shop 参数（可能从新URL中获取）
        var shopIdFromUrl = getShopIdFromUrl();
        if (shopIdFromUrl && (!window._shopInfo || window._shopInfo.id !== shopIdFromUrl)) {
            loadShopInfo().then(function() {
                var tabOverride = (page === 'chat-list') ? 'chat' : null;
                renderPageContent(page, e.detail.params, tabOverride);
            });
        } else {
            var tabOverride = (page === 'chat-list') ? 'chat' : null;
            renderPageContent(page, e.detail.params, tabOverride);
        }
    });

    // 渲染初始页面
    var hashInfo = parseHash(window.location.hash);
    var page = resolvePage(hashInfo.route || 'home', hashInfo.params);

    // 初始页面的认证守卫
    if (!authGuard(page)) return;

    var tabOverride = (page === 'chat-list') ? 'chat' : null;
    renderPageContent(page, hashInfo.params, tabOverride);
}

/**
 * 获取 shop 参数追加字符串（用于导航时保持 shop 参数）
 */
function getShopAppend() {
    var shopId = window._shopInfo ? window._shopInfo.id : null;
    if (!shopId) shopId = sessionStorage.getItem('shopId');
    return shopId ? '&shop=' + encodeURIComponent(shopId) : '';
}

/**
 * 「关于」页面 - 未登录顾客看到的第4个标签页
 * 显示 App 简介，底部提供店家登录入口（醒目按钮）
 */
App.registerPage('about', {
    render: function() {
        var shopAppend = getShopAppend();
        return '<div style="min-height:100vh;background:#F8F6F1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;">' +
            // 图标
            '<div style="font-size:64px;margin-bottom:20px;">🎲</div>' +
            // 标题
            '<div style="font-size:24px;font-weight:700;color:#2D2A26;margin-bottom:8px;">桌游AI教练</div>' +
            // 副标题
            '<div style="font-size:15px;color:#C4864B;margin-bottom:24px;">AI驱动的桌游教学助手</div>' +
            // 简介
            '<div style="max-width:300px;font-size:14px;color:#6B6258;line-height:1.8;margin-bottom:28px;">' +
            '扫码学习桌游规则，让桌游入门不再难</div>' +
            // 版本
            '<div style="font-size:12px;color:#B5AFA6;margin-bottom:36px;">v1.0</div>' +

            '</div>';
    },
    init: function() {}  // 无异步初始化
});

// 页面加载完成后初始化应用
document.addEventListener('DOMContentLoaded', initApp);
