/**
 * 桌游AI教练 - 首页（推荐和发现）
 */
console.log('[home.js] 文件开始加载');

App.registerPage('home', (function() {
    // ==================== 状态管理 ====================
    var state = {
        allGames: [],
        isLoading: true,
        loadError: null,
        currentBanner: 0,
        bannerTimer: null,
        guessGames: []
    };
    window.homeState = state;

    // 分类配置
    var categories = [
        { emoji: '🌱', name: '入门推荐', param: '入门' },
        { emoji: '🎉', name: '聚会必玩', param: '聚会' },
        { emoji: '⚔️', name: '两人对决', param: '双人' },
        { emoji: '🧠', name: '策略烧脑', param: '策略' },
        { emoji: '🔍', name: '推理阵营', param: '推理' },
        { emoji: '🎲', name: '美式冒险', param: '美式' },
        { emoji: '⚒️', name: '德式经典', param: '德式' }
    ];

    // 热门游戏列表
    var hotGameNames = ['卡坦岛', '狼人杀', '阿瓦隆', '璀璨宝石', '情书', '行动代号'];

    // ==================== 工具函数 ====================
    function formatInfo(game) {
        var minP = game.min_players || game.minPlayers || 0;
        var maxP = game.max_players || game.maxPlayers || 0;
        var players = minP === maxP ? minP + '人' : minP + '-' + maxP + '人';
        var dur = game.play_time || game.duration || 30;
        return players + ' · ' + dur + '分钟';
    }

    function getDifficultyStars(difficulty) {
        var level = parseInt(difficulty) || 1;
        if (level > 5) level = 5;
        return '⭐'.repeat(level);
    }

    function shuffleArray(arr) {
        var result = arr.slice();
        for (var i = result.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var temp = result[i];
            result[i] = result[j];
            result[j] = temp;
        }
        return result;
    }

    function getGuessGames() {
        var all = state.allGames;
        if (!all || all.length === 0) return [];

        // 尝试从localStorage获取最近浏览的分类
        var recentCats = localStorage.getItem('recentCategories');
        var result = [];

        if (recentCats) {
            var catArr = recentCats.split(',');
            // 每个分类取一款
            catArr.forEach(function(cat) {
                if (result.length >= 6) return;
                var game = all.find(function(g) {
                    return g.category === cat && result.indexOf(g) === -1;
                });
                if (game) result.push(game);
            });
        }

        // 如果不够6个，随机补充
        if (result.length < 6) {
            var remaining = all.filter(function(g) { return result.indexOf(g) === -1; });
            var shuffled = shuffleArray(remaining);
            for (var i = 0; result.length < 6 && i < shuffled.length; i++) {
                result.push(shuffled[i]);
            }
        }

        return result.slice(0, 6);
    }

    function recordCategory(category) {
        if (!category) return;
        var recent = localStorage.getItem('recentCategories') || '';
        var cats = recent ? recent.split(',').filter(function(c) { return c !== category; }) : [];
        cats.unshift(category);
        localStorage.setItem('recentCategories', cats.slice(0, 5).join(','));
    }

    // ==================== 数据加载 ====================
    async function loadGamesFromDB() {
        // 防止重复加载
        if (state._loading) return;
        state._loading = true;

        console.log('[home.js] 开始加载游戏数据');
        state.isLoading = true;
        state.loadError = null;

        window.homePageRender();

        var apiGames = null;
        var apiError = null;

        // 尝试从API加载
        try {
            if (typeof window.getGames === 'function') {
                apiGames = await window.getGames({});
                console.log('[home.js] API返回游戏数量:', apiGames ? apiGames.length : 0);
            }
        } catch (error) {
            apiError = error;
            console.warn('[home.js] API加载失败:', error.message);
        }

        // 只有真正的网络/API 报错才标记为错误状态
        // API 正常返回了数组（哪怕 0 款）就说明加载成功
        if (apiGames === null || apiGames === undefined) {
            state.loadError = apiError ? apiError.message : '数据加载失败';
            state.isLoading = false;
            window.homePageRender();
            return;
        }

        state.allGames = apiGames;
        state.isLoading = false;
        state.loadError = null;
        state.guessGames = getGuessGames();
        state._loading = false;
        window.homePageRender();
    }

    // ==================== 渲染函数 ====================
    function renderLoading() {
        return '<div class="home-loading" style="text-align:center;padding:100px 20px;color:#8C8578;">' +
            '<div style="font-size:24px;margin-bottom:10px;">🎲</div>' +
            '<div>加载中...</div></div>';
    }

    function renderError() {
        return '<div class="home-error" style="text-align:center;padding:100px 20px;color:#8C8578;">' +
            '<div style="font-size:48px;margin-bottom:16px;">😢</div>' +
            '<div style="margin-bottom:16px;">加载失败: ' + (state.loadError || '未知错误') + '</div>' +
            '<button onclick="homePage.reload()" style="padding:12px 24px;background:#C4864B;color:#fff;border:none;border-radius:8px;cursor:pointer;">重新加载</button>' +
            '</div>';
    }

    function renderSearchBar() {
        return '<div class="home-search-bar">' +
            '<div class="home-search-input-wrap">' +
            '<span class="home-search-icon">🔍</span>' +
            '<input type="text" class="home-search-input" placeholder="搜索桌游名称..." readonly onclick="homePage.goLibrary()">' +
            '</div>' +
            '<div class="home-user-avatar">👤</div>' +
            '</div>';
    }

    function renderBanner() {
        return '<div id="banner-container" style="position:relative;width:calc(100% - 32px);height:180px;overflow:hidden;border-radius:12px;margin:0 16px 20px 16px;cursor:pointer;">' +
            '<div id="banner-track" style="display:flex;width:300%;height:100%;transition:transform 0.3s ease;">' +
            '<div style="width:33.333%;height:100%;background:linear-gradient(135deg,#F5D5B0,#E8C08A);display:flex;flex-direction:column;justify-content:center;align-items:center;flex-shrink:0;" onclick="window.location.hash=\'/library\'">' +
            '<div style="font-size:24px;color:#2D2A26;font-weight:bold;">🔥 热门推荐</div>' +
            '<div style="font-size:14px;color:rgba(45,42,38,0.7);margin-top:8px;">最受欢迎的桌游都在这里</div>' +
            '</div>' +
            '<div style="width:33.333%;height:100%;background:linear-gradient(135deg,#C5D5E8,#A8BED8);display:flex;flex-direction:column;justify-content:center;align-items:center;flex-shrink:0;" onclick="window.location.hash=\'/library?category=入门\'">' +
            '<div style="font-size:24px;color:#2D2A26;font-weight:bold;">🌱 新手入门</div>' +
            '<div style="font-size:14px;color:rgba(45,42,38,0.7);margin-top:8px;">从这几款开始你的桌游之旅</div>' +
            '</div>' +
            '<div style="width:33.333%;height:100%;background:linear-gradient(135deg,#D5C8E8,#BFB0D8);display:flex;flex-direction:column;justify-content:center;align-items:center;flex-shrink:0;" onclick="window.location.hash=\'/library?duration=30\'">' +
            '<div style="font-size:24px;color:#2D2A26;font-weight:bold;">⚡ 30分钟速开</div>' +
            '<div style="font-size:14px;color:rgba(45,42,38,0.7);margin-top:8px;">时间有限也能玩得开心</div>' +
            '</div>' +
            '</div>' +
            '<div style="position:absolute;bottom:10px;left:50%;transform:translateX(-50%);display:flex;gap:6px;">' +
            '<span id="dot0" style="width:8px;height:8px;border-radius:50%;background:#C4864B;"></span>' +
            '<span id="dot1" style="width:8px;height:8px;border-radius:50%;background:#D5D0C8;"></span>' +
            '<span id="dot2" style="width:8px;height:8px;border-radius:50%;background:#D5D0C8;"></span>' +
            '</div>' +
            '</div>';
    }

    function renderCategories() {
        var items = categories.map(function(cat) {
            return '<div class="category-item" onclick="homePage.goLibraryWithCategory(\'' + cat.param + '\')">' +
                '<div class="category-icon">' + cat.emoji + '</div>' +
                '<div class="category-name">' + cat.name + '</div>' +
                '</div>';
        }).join('');

        return '<div class="home-categories-section">' +
            '<div class="categories-scroll">' + items + '</div>' +
            '</div>';
    }

    // 过滤无效游戏对象（无name或id）
    function isValidGame(g) {
        return g && typeof g === 'object' && g.name && g.id;
    }
    function renderGameCard(game) {
        if (!isValidGame(game)) return '';
        var gradients = ['linear-gradient(135deg, #F5D5B0, #E8C08A)', 'linear-gradient(135deg, #C5D5E8, #A8BED8)',
            'linear-gradient(135deg, #D5C8E8, #BFB0D8)', 'linear-gradient(135deg, #7B9E87, #5a7e67)'];
        var bg = gradients[Math.abs(game.id ? game.id.charCodeAt(0) : 0) % gradients.length];
        var emoji = game.emoji || '🎲';

        // 封面内容：有图片则显示图片，否则显示渐变色 + emoji
        var coverUrl = (game && (game.cover_image || game.cover_url || game.cover)) || '';
        if (coverUrl) {
            if (coverUrl.indexOf('http://') !== 0 && coverUrl.indexOf('https://') !== 0) {
                if (coverUrl.charAt(0) !== '/') {
                    coverUrl = '/' + coverUrl;
                }
                coverUrl = 'https://boardgame-hub.onrender.com' + coverUrl;
            }
        }
        var coverHtml = coverUrl
            ? '<img class="game-card-cover-img" src="' + coverUrl + '" alt="' + (game.name || '') + '" ' +
              'onerror="this.onerror=null;this.parentElement.innerHTML=\'<span class=&quot;game-card-emoji&quot;>' + emoji + '</span>\';">'
            : '<span class="game-card-emoji">' + emoji + '</span>';

        return '<div class="game-card-small" onclick="homePage.goDetail(\'' + game.id + '\', \'' + (game.category || '') + '\')">' +
            '<div class="game-card-cover" style="background:' + bg + '">' +
            coverHtml +
            '</div>' +
            '<div class="game-card-info">' +
            '<div class="game-card-name">' + (game.name_cn || game.name || '未知游戏') + '</div>' +
            '<div class="game-card-meta">' + formatInfo(game) + '</div>' +
            '<div class="game-card-stars">' + getDifficultyStars(game.difficulty) + '</div>' +
            '</div>' +
            '</div>';
    }

    function renderSection(title, titleEmoji, linkText, linkHash, onClick) {
        return '<div class="home-section">' +
            '<div class="section-header">' +
            '<div class="section-title">' + titleEmoji + ' ' + title + '</div>' +
            '<div class="section-more" ' + (onClick ? 'onclick="' + onClick + '"' : 'onclick="homePage.goLibraryWithLink(\'' + linkHash + '\')"') + '>' + linkText + ' &gt;</div>' +
            '</div>';
    }

    function renderNewbieSection() {
        var newbieGames = state.allGames.filter(function(g) {
            var diff = g.difficulty;
            var diffNum = parseInt(diff);
            var diffStr = String(diff || '');
            // 兼容数字1、字符串"1"、中文"入门"等多种可能值
            return diffNum === 1 || diffStr === '1' || diffStr === '入门';
        });
        console.log('[home.js] 入门游戏数量:', newbieGames.length);
        console.log('[home.js] 入门游戏:', newbieGames.map(function(g) { return g.name + '(diff=' + g.difficulty + ')'; }));

        // 兜底：如果筛选结果为空，使用 allGames 前6个
        if (newbieGames.length === 0) {
            console.log('[home.js] 无入门游戏，使用前6个兜底');
            newbieGames = state.allGames.slice(0, 6);
        }

        var games = newbieGames.slice(0, 6);
        var cards = games.filter(isValidGame).map(renderGameCard).join('');
        return renderSection('第一次玩桌游？', '🌱', '查看更多', '?category=入门') +
            '<div class="games-scroll">' + cards + '</div></div>';
    }

    function renderHotSection() {
        var result = [];
        hotGameNames.forEach(function(name) {
            var game = state.allGames.find(function(g) { return g.name === name; });
            if (game && result.indexOf(game) === -1) {
                result.push(game);
            }
        });

        // 如果不够6个，补充allGames的前几个
        if (result.length < 6) {
            state.allGames.forEach(function(g) {
                if (result.length >= 6) return;
                if (result.indexOf(g) === -1) {
                    result.push(g);
                }
            });
        }

        var cards = result.slice(0, 6).filter(isValidGame).map(renderGameCard).join('');
        return renderSection('大家都在玩', '🔥', '查看更多', '?category=热门') +
            '<div class="games-scroll">' + cards + '</div></div>';
    }

    function renderGuessSection() {
        var games = state.guessGames.length > 0 ? state.guessGames : getGuessGames();
        var cards = games.filter(isValidGame).map(renderGameCard).join('');
        return renderSection('猜你想玩', '✨', '换一批', '', 'homePage.refreshGuess()') +
            '<div class="games-scroll">' + cards + '</div></div>';
    }

    function renderQuickPlaySection() {
        var quickGames = state.allGames.filter(function(g) {
            var time = g.play_time || g.duration || 60;
            return parseInt(time) <= 30;
        });
        console.log('[home.js] 30分钟速开游戏数量:', quickGames.length);

        // 兜底：如果筛选结果为空，使用 allGames 前6个
        if (quickGames.length === 0) {
            console.log('[home.js] 无速开游戏，使用前6个兜底');
            quickGames = state.allGames.slice(0, 6);
        }

        var games = quickGames.slice(0, 6);
        var cards = games.filter(isValidGame).map(renderGameCard).join('');
        return renderSection('30分钟内能玩完', '⚡', '查看更多', '?duration=30') +
            '<div class="games-scroll">' + cards + '</div></div>';
    }

    function render() {
        if (state.isLoading) {
            return '<div class="home-page" style="background:#F8F6F1;min-height:100vh;">' + renderLoading() + '</div>';
        }
        if (state.loadError) {
            return '<div class="home-page" style="background:#F8F6F1;min-height:100vh;">' + renderError() + '</div>';
        }

        // 数据为空时显示提示
        if (!state.allGames || state.allGames.length === 0) {
            return '<div class="home-page" style="background:#F8F6F1;min-height:100vh;">' +
                renderSearchBar() +
                '<div style="text-align:center;padding:80px 20px;color:#8C8578;">' +
                '<div style="font-size:48px;margin-bottom:16px;">🎲</div>' +
                '<div style="font-size:16px;">桌游库正在完善中，请稍后再来</div>' +
                '</div></div>';
        }

        return '<div class="home-page" style="background:#F8F6F1;min-height:100vh;">' +
            renderSearchBar() +
            renderBanner() +
            renderCategories() +
            '<div class="home-sections">' +
            renderNewbieSection() +
            renderHotSection() +
            renderGuessSection() +
            renderQuickPlaySection() +
            '</div></div>';
    }

    // ==================== 事件处理 ====================
    function goLibrary() {
        window.location.hash = '/library';
    }

    function goLibraryWithCategory(category) {
        window.location.hash = '/library?category=' + encodeURIComponent(category);
    }

    function goLibraryWithLink(hash) {
        window.location.hash = '/library' + hash;
    }

    function goDetail(id, category) {
        console.log('[home.js] goDetail, ID:', id);
        if (category) {
            recordCategory(category);
        }
        sessionStorage.setItem('chatFrom', '/detail?id=' + id);
        window.location.hash = '/detail?id=' + encodeURIComponent(id);
    }

    function reload() {
        state.allGames = [];
        state._loading = false;
        state.isLoading = true;
        state.loadError = null;
        window.homePageRender();
        loadGamesFromDB();
    }

    function refreshGuess() {
        state.guessGames = shuffleArray(getGuessGames());
        window.homePageRender();
    }

    function startBannerAutoPlay() {
        stopBannerAutoPlay();
        state.bannerTimer = setInterval(function() {
            slideTo((state.currentBanner + 1) % 3);
        }, 4000);
    }

    function stopBannerAutoPlay() {
        if (state.bannerTimer) {
            clearInterval(state.bannerTimer);
            state.bannerTimer = null;
        }
    }

    function slideTo(index) {
        state.currentBanner = index;
        var track = document.getElementById('banner-track');
        if (track) {
            track.style.transform = 'translateX(-' + (index * 33.333) + '%)';
        }
        // 更新圆点（用 ID dot0/dot1/dot2）
        for (var j = 0; j < 3; j++) {
            var dot = document.getElementById('dot' + j);
            if (dot) dot.style.background = j === index ? '#C4864B' : '#D5D0C8';
        }
    }

    function bindBannerEvents() {
        var container = document.getElementById('banner-container');
        if (!container) return;

        var startX = 0;

        container.addEventListener('touchstart', function(e) {
            startX = e.touches[0].clientX;
            stopBannerAutoPlay();
        });

        container.addEventListener('touchend', function(e) {
            var endX = e.changedTouches[0].clientX;
            var diff = endX - startX;
            if (Math.abs(diff) > 50) {
                if (diff < 0) {
                    slideTo((state.currentBanner + 1) % 3);
                } else {
                    slideTo((state.currentBanner - 1 + 3) % 3);
                }
            }
            startBannerAutoPlay();
        });

        // 点击圆点切换
        container.addEventListener('click', function(e) {
            var targetId = e.target.id;
            if (targetId && targetId.indexOf('dot') === 0) {
                var index = parseInt(targetId.replace('dot', ''));
                if (!isNaN(index) && index >= 0 && index < 3) {
                    slideTo(index);
                    stopBannerAutoPlay();
                    startBannerAutoPlay();
                }
            }
        });

        startBannerAutoPlay();
    }

    // ==================== 初始化 ====================
    function init() {
        if (state._loading) return;
        loadGamesFromDB();
        setTimeout(bindBannerEvents, 100);
    }

    // 导出页面对象
    var page = {
        render: render,
        init: init,
        goLibrary: goLibrary,
        goLibraryWithCategory: goLibraryWithCategory,
        goLibraryWithLink: goLibraryWithLink,
        goDetail: goDetail,
        reload: reload,
        refreshGuess: refreshGuess
    };

    // 全局暴露
    window.homePage = page;
    window.homePageRender = function() {
        if (window._activePage !== 'home') return;
        var app = document.getElementById('app');
        if (app) {
            app.innerHTML = (window.renderShopHeader ? window.renderShopHeader() : '') + page.render() + window.getTabBarHtml('home');
            window.bindTabBarEvents();
        }
    };

    return page;
})());
