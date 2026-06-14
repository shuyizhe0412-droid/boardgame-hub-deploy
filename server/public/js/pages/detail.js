/**
 * 桌游AI教练 - 游戏详情页
 */
App.registerPage('detail', (function() {
    // ==================== 状态管理 ====================
    var state = {
        gameId: '',
        game: null,
        isFavorite: false,
        descExpanded: false,
        isLoading: true,
        loadError: null,
        // 规则速查（只读查看）
        showRuleModal: false,
        ruleText: '',           // 规则文本
        ruleFromServer: '',     // 服务端保存的规则
        ruleLoading: false,
        ruleCollapsedSections: {}   // { index: true } = 已折叠
    };

    // ==================== 工具函数 ====================
    // 从 URL hash 解析游戏 ID
    function getGameIdFromHash() {
        console.log('[detail.js] 当前URL:', window.location.hash);
        var hash = window.location.hash || '';
        var match = hash.match(/[?&]id=([^&]+)/);
        var id = match ? decodeURIComponent(match[1]) : null;
        console.log('[detail.js] 解析到的游戏ID:', id, '类型:', typeof id);
        return id;
    }

    function formatDuration(minutes) {
        if (minutes >= 60) {
            var h = Math.floor(minutes / 60);
            var m = minutes % 60;
            return m > 0 ? h + '小时' + m + '分钟' : h + '小时';
        }
        return minutes + '分钟';
    }

    function getDifficultyText(level) {
        var map = { 1: '入门', 2: '简单', 3: '中等', 4: '困难', 5: '专家' };
        return map[level] || '入门';
    }

    function renderStars(rating) {
        var full = Math.floor(rating);
        var half = rating % 1 >= 0.5;
        var empty = 5 - full - (half ? 1 : 0);
        return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
    }

    function renderRatingBar(value) {
        var percent = (value / 5) * 100;
        return '<div class="detail-rating-bar">' +
            '<div class="detail-rating-fill" style="width:' + percent + '%"></div>' +
            '</div>';
    }

    // ==================== 渲染函数 ====================
    function renderHeader() {
        return '<div class="detail-header">' +
            '<span class="detail-back" onclick="detailPage.goBack()">← 返回</span>' +
            '</div>';
    }

    function renderLoading() {
        return '<div class="detail-page">' +
            renderHeader() +
            '<div class="detail-loading" style="text-align:center;padding:50px;color:#8C8578;">加载中...</div>' +
            '</div>';
    }

    function renderError() {
        return '<div class="detail-page">' +
            renderHeader() +
            '<div class="detail-error" style="text-align:center;padding:50px;color:#e74c3c;">' +
            '<p>加载失败</p>' +
            '<p style="font-size:12px;color:#8C8578;">' + state.loadError + '</p>' +
            '<button onclick="detailPage.goBack()" style="margin-top:20px;padding:10px 20px;background:#C4864B;color:#fff;border:none;border-radius:5px;">返回首页</button>' +
            '</div>' +
            '</div>';
    }

    function renderDefaultCover() {
        var emoji = (state.game && state.game.emoji) || '🎲';
        return '<span class="detail-cover-text">' + emoji + '</span>';
    }

    function renderCover() {
        var game = state.game;
        var coverUrl = '';
        if (game) {
            coverUrl = game.cover_image || game.cover_url || game.cover || '';
        }

        if (coverUrl) {
            // 处理相对路径：不是 http/https 开头则拼接后端域名
            if (coverUrl.indexOf('http://') !== 0 && coverUrl.indexOf('https://') !== 0) {
                if (coverUrl.charAt(0) !== '/') {
                    coverUrl = '/' + coverUrl;
                }
                coverUrl = 'https://boardgame-hub.onrender.com' + coverUrl;
            }
            return '<div class="detail-cover">' +
                '<img class="detail-cover-img" src="' + coverUrl + '" alt="' + (game ? (game.name || '') : '') + '" ' +
                'onerror="this.onerror=null;var p=this.parentElement;' +
                'p.innerHTML=detailPage.renderDefaultCover();' +
                'p.style.display=\'flex\';p.style.alignItems=\'center\';p.style.justifyContent=\'center\';p.style.minHeight=\'180px\';">' +
                '</div>';
        }

        return '<div class="detail-cover">' +
            renderDefaultCover() +
            '</div>';
    }

    function renderInfo() {
        var game = state.game;
        if (!game) return '<div class="detail-info card"><p>游戏数据不存在</p></div>';
        
        var desc = game.description_cn || game.description || '';
        var shortDesc = desc.length > 60 ? desc.substring(0, 60) + '...' : desc;
        var displayDesc = state.descExpanded ? desc : shortDesc;
        var expandText = state.descExpanded ? '收起' : (desc.length > 60 ? '展开' : '');

        // 处理字段名兼容性
        var minPlayers = game.min_players || game.minPlayers || 0;
        var maxPlayers = game.max_players || game.maxPlayers || 0;
        var duration = game.duration || 30;
        var difficulty = game.difficulty || 2;
        var tags = game.tags || [];

        return '<div class="detail-info card">' +
            '<h1 class="detail-title">' + (game.name_cn || game.name || '未知游戏') + '</h1>' +
            '<p class="detail-subtitle">' + ((game.name_cn && game.name && game.name !== game.name_cn) ? game.name : '') + '</p>' +
            '<div class="detail-stats">' +
            '<div class="detail-stat"><span>👥</span><span>' + minPlayers + '-' + maxPlayers + '人</span></div>' +
            '<div class="detail-stat"><span>⏱️</span><span>' + formatDuration(duration) + '</span></div>' +
            '<div class="detail-stat"><span>📊</span><span>' + getDifficultyText(difficulty) + '</span></div>' +
            '</div>' +
            '<div class="detail-tags">' +
            tags.map(function(tag) {
                return '<span class="detail-tag">' + tag + '</span>';
            }).join('') +
            '</div>' +
            '<p class="detail-desc">' + displayDesc + '</p>' +
            (expandText ? '<span class="detail-expand" onclick="detailPage.toggleDesc()">' + expandText + '</span>' : '') +
            '</div>';
    }

    function renderAIButtons() {
        return '<div class="detail-ai-buttons">' +
            '<button class="detail-ai-btn" onclick="detailPage.goChat(\'setup\')">' +
            '<span>🎯</span><span>摆盘引导</span></button>' +
            '<button class="detail-ai-btn" onclick="detailPage.goChat(\'rules\')">' +
            '<span>📖</span><span>规则教学</span></button>' +
            '<button class="detail-ai-btn" onclick="detailPage.showRules()">' +
            '<span>🔍</span><span>规则速查</span></button>' +
            '</div>';
    }

    function renderRatings() {
        var game = state.game;
        if (!game || !game.ratings) return '';
        
        var ratings = game.ratings;
        var avgRating = ((ratings.difficulty || 0) + (ratings.fun || 0) + (ratings.replay || 0) + (ratings.上手 || 0)) / 4;
        avgRating = isNaN(avgRating) ? 0 : avgRating.toFixed(1);

        return '<div class="detail-ratings card">' +
            '<h3>玩家评分</h3>' +
            '<div class="detail-rating-item"><span>难度</span>' + renderRatingBar(ratings.difficulty || 0) + '<span>' + (ratings.difficulty || 0) + '</span></div>' +
            '<div class="detail-rating-item"><span>趣味</span>' + renderRatingBar(ratings.fun || 0) + '<span>' + (ratings.fun || 0) + '</span></div>' +
            '<div class="detail-rating-item"><span>重玩</span>' + renderRatingBar(ratings.replay || 0) + '<span>' + (ratings.replay || 0) + '</span></div>' +
            '<div class="detail-rating-item"><span>上手</span>' + renderRatingBar(ratings.上手 || 0) + '<span>' + (ratings.上手 || 0) + '</span></div>' +
            '<div class="detail-avg-rating"><span>综合</span><span class="detail-avg-num">' + avgRating + '</span></div>' +
            '</div>';
    }

    function renderComments() {
        var game = state.game;
        if (!game) return '';
        
        var comments = game.comments || [];
        var commentsHtml = '';

        if (comments.length === 0) {
            commentsHtml = '<p class="detail-no-comment">暂无评论，成为第一个评论者吧！</p>';
        } else {
            commentsHtml = comments.map(function(c) {
                return '<div class="detail-comment card">' +
                    '<div class="detail-comment-header">' +
                    '<div class="detail-comment-avatar">👤</div>' +
                    '<div class="detail-comment-meta">' +
                    '<span class="detail-comment-name">' + (c.user || '匿名') + '</span>' +
                    '<span class="detail-comment-stars">' + renderStars(c.rating || 0) + '</span>' +
                    '</div>' +
                    '</div>' +
                    '<div class="detail-comment-tags">' +
                    (c.tags || []).map(function(t) { return '<span class="detail-tag">' + t + '</span>'; }).join('') +
                    '</div>' +
                    '<p class="detail-comment-content">' + (c.content || '') + '</p>' +
                    '</div>';
            }).join('');
        }

        return '<div class="detail-comments">' +
            '<h3>精选评论</h3>' +
            commentsHtml +
            '<button class="detail-write-btn" onclick="detailPage.writeComment()">✏️ 写评论</button>' +
            '</div>';
    }

    function renderFavoriteBtn() {
        var icon = state.isFavorite ? '❤️' : '🤍';
        return '<div class="detail-favorite-btn" onclick="detailPage.toggleFavorite()">' + icon + '</div>';
    }

    // ==================== 规则速查 & 编辑 ====================

    // 解析规则文本为章节数组（按【】分隔）
    function parseRuleSections(rulesText) {
        if (!rulesText) return [];
        // 检查是否含【】标记
        if (rulesText.indexOf('【') !== -1) {
            var sections = [];
            var regex = /【([^】]+)】([^【]*)/g;
            var match;
            while ((match = regex.exec(rulesText)) !== null) {
                sections.push({
                    title: match[1].trim(),
                    content: match[2].trim()
                });
            }
            return sections;
        }
        // 无【】标记时，按换行拆分，每行一个章节
        var lines = rulesText.split(/\n/).filter(function(l) { return l.trim(); });
        if (lines.length <= 1) {
            return [{ title: '规则说明', content: rulesText }];
        }
        var items = [];
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            var numMatch = line.match(/^(\d+)[\.、．]\s*/);
            var title = numMatch ? '规则 ' + numMatch[1] : '规则 ' + (i + 1);
            var content = numMatch ? line.replace(/^\d+[\.、．]\s*/, '') : line;
            items.push({ title: title, content: content });
        }
        return items;
    }

    // 检测是否为表格型章节（建筑成本等）
    function isTableSection(section) {
        var title = section.title;
        if (title.indexOf('建筑') !== -1 || title.indexOf('成本') !== -1 ||
            title.indexOf('表格') !== -1) {
            return section.content.indexOf('：') !== -1 || section.content.indexOf(':') !== -1;
        }
        return false;
    }

    // 加粗数字
    function boldNumbers(text) {
        return text.replace(/(\d+)/g, '<b class="rules-num">$1</b>');
    }

    // 渲染表格型章节内容
    function renderTableContent(content) {
        var rows = content.split(/\n/).filter(function(l) { return l.trim(); });
        var html = '<div class="rules-section-table">' +
            '<div class="rules-table-row rules-table-head">' +
            '<span class="rules-table-cell">项目</span>' +
            '<span class="rules-table-cell">详情</span>' +
            '</div>';
        for (var i = 0; i < rows.length; i++) {
            var parts = rows[i].split(/[：:]/);
            var key = (parts[0] || '').trim();
            var val = (parts.slice(1).join(':') || '').trim();
            html += '<div class="rules-table-row">' +
                '<span class="rules-table-cell">' + boldNumbers(key) + '</span>' +
                '<span class="rules-table-cell">' + boldNumbers(val) + '</span>' +
                '</div>';
        }
        html += '</div>';
        return html;
    }

    // 切换章节折叠状态
    function toggleRuleSection(index) {
        state.ruleCollapsedSections[index] = !state.ruleCollapsedSections[index];
        var section = document.querySelector('.rules-section[data-index="' + index + '"]');
        if (!section) return;
        var arrow = section.querySelector('.rules-section-arrow');
        if (state.ruleCollapsedSections[index]) {
            section.classList.remove('expanded');
            section.classList.add('collapsed');
            if (arrow) arrow.textContent = '▸';
        } else {
            section.classList.remove('collapsed');
            section.classList.add('expanded');
            if (arrow) arrow.textContent = '▾';
        }
    }

    function renderRuleModalToBody() {
        // 移除现有弹窗
        var existing = document.getElementById('rule-modal');
        if (existing) existing.remove();

        if (!state.showRuleModal) return;

        var game = state.game;
        var gameName = game ? (game.name || '未知游戏') : '未知游戏';

        // 只读模式：全屏结构化规则弹窗
        var rulesText = '';
        if (state.ruleFromServer) {
            rulesText = state.ruleFromServer;
        } else if (game && game.rules) {
            rulesText = typeof game.rules === 'string' ? game.rules : '';
        }

        var sections = parseRuleSections(rulesText);
        var sectionsHtml = '';
        if (state.ruleLoading) {
            sectionsHtml = '<div class="rules-fs-loading">加载中...</div>';
        } else if (sections.length === 0) {
            sectionsHtml = '<div class="rules-fs-no-rules-guide">' +
                '<div class="rules-fs-no-rules-icon">📝</div>' +
                '<div class="rules-fs-no-rules-title">该游戏暂未上传规则摘要</div>' +
                '<div class="rules-fs-no-rules-desc">你可以通过 AI 对话了解基础规则（AI回答仅供参考，请以官方说明书为准）</div>' +
                '<button class="rules-fs-no-rules-btn" onclick="event.preventDefault(); event.stopPropagation(); detailPage.goAskAI();">去问AI教练</button>' +
                '<div class="rules-fs-no-rules-bottom">或者联系店家上传规则</div>' +
                '</div>';
        } else {
            for (var i = 0; i < sections.length; i++) {
                var s = sections[i];
                var isExpanded = !state.ruleCollapsedSections[i];
                var sectionClass = isExpanded ? 'rules-section expanded' : 'rules-section collapsed';
                var arrowSymbol = isExpanded ? '▾' : '▸';
                var contentHtml = '';
                if (isTableSection(s)) {
                    contentHtml = renderTableContent(s.content);
                } else {
                    contentHtml = '<div class="rules-section-text">' + boldNumbers(s.content.replace(/\n/g, '<br>')) + '</div>';
                }
                sectionsHtml += '<div class="' + sectionClass + '" data-index="' + i + '">' +
                    '<div class="rules-section-header" onclick="detailPage.toggleRuleSection(' + i + ')">' +
                    '<span class="rules-section-arrow">' + arrowSymbol + '</span>' +
                    '<span class="rules-section-name">' + s.title + '</span>' +
                    '</div>' +
                    '<div class="rules-section-content">' + contentHtml + '</div>' +
                    '</div>';
            }
        }

        var innerHTML = '<div class="rules-fs-overlay" onclick="detailPage.closeRules(event)">' +
            '<div class="rules-fs-modal" onclick="event.stopPropagation()">' +
            '<div class="rules-fs-header">' +
            '<span class="rules-fs-title">规则速查 · ' + gameName + '</span>' +
            '<span class="rules-fs-close" onclick="detailPage.closeRules()">✕</span>' +
            '</div>' +
            '<div class="rules-fs-body">' +
            sectionsHtml +
            '</div>' +
            '<div class="rules-fs-footer">' +
            '<a class="rules-fs-ai-btn" href="javascript:void(0)" onclick="event.preventDefault(); event.stopPropagation(); detailPage.goAskAI();">🤖 还有疑问？问AI教练</a>' +
            '<button class="rules-fs-back-btn" onclick="detailPage.closeRules()">← 返回详情</button>' +
            '</div>' +
            '</div>' +
            '</div>';

        var modal = document.createElement('div');
        modal.id = 'rule-modal';
        modal.innerHTML = innerHTML;
        document.body.appendChild(modal);
    }

    function showRules() {
        console.log('[detail.js] showRules 被调用, gameId:', state.gameId);
        state.showRuleModal = true;
        state.ruleLoading = true;
        state.ruleFromServer = '';
        state.ruleText = '';
        state.ruleCollapsedSections = {};
        loadGameRulesFromServer();
    }

    function closeRules(event) {
        if (event) { event.stopPropagation(); event.preventDefault(); }
        var modal = document.getElementById('rule-modal');
        if (modal) modal.remove();
        state.showRuleModal = false;
        state.ruleLoading = false;
    }

    async function loadGameRulesFromServer() {
        if (!state.gameId) {
            state.ruleLoading = false;
            state.ruleFromServer = '';
            renderRuleModalToBody();
            return;
        }
        console.log('[detail.js] 加载规则, gameId:', state.gameId, ', gameName:', (state.game && state.game.name));

        // 优先级1：从 rule_sections 表加载智能解析的规则
        try {
            var sectionsData = await window.getRuleSections(state.gameId);
            if (sectionsData && sectionsData.sections && sectionsData.sections.length > 0) {
                var formatted = sectionsData.sections.map(function(s) {
                    return '【' + (s.section_title || ('第' + s.page_number + '页')) + '】' + s.content;
                }).join('\n\n');
                console.log('[detail.js] rule_sections 命中，段数:', sectionsData.sections.length);
                state.ruleFromServer = formatted;
                state.ruleText = formatted;
                state.ruleLoading = false;
                renderRuleModalToBody();
                return;
            }
            console.log('[detail.js] rule_sections 为空，尝试其他来源');
        } catch (e) {
            console.warn('[detail.js] rule_sections 加载失败:', e.message);
        }

        // 优先级2：从服务端规则摘要加载
        try {
            var rules = await window.getGameRules(state.gameId);
            console.log('[detail.js] getGameRules 返回:', rules ? ('长度=' + rules.length) : '空');
            state.ruleFromServer = rules || '';
            state.ruleText = rules || '';
        } catch (e) {
            console.warn('[detail.js] getGameRules 异常:', e.message);
            state.ruleFromServer = '';
            state.ruleText = '';
        }

        // 兜底：getGameRules 返回空，但 game 对象自带 rules 字段（来自 API 的真实数据）
        if (!state.ruleFromServer && state.game && state.game.rules && typeof state.game.rules === 'string') {
            console.log('[detail.js] 兜底: 使用 game 对象自带的 rules');
            state.ruleFromServer = state.game.rules;
            state.ruleText = state.game.rules;
        }

        state.ruleLoading = false;
        renderRuleModalToBody();
    }

    function goAskAI() {
        console.log('goAskAI 被调用');
        var modal = document.getElementById('rule-modal');
        if (modal) modal.remove();
        state.showRuleModal = false;
        sessionStorage.setItem('chatFrom', '/detail?id=' + state.gameId);
        window.location.hash = '/chat?mode=faq&gameId=' + state.gameId;
    }

    function render(params) {
        // 加载中状态
        if (state.isLoading) {
            return renderLoading();
        }
        // 错误状态
        if (state.loadError) {
            return renderError();
        }
        // 如果外部传入了 gameId，优先使用
        if (params && params.id && !state.gameId) {
            state.gameId = params.id;
        }
        return '<div class="detail-page">' +
            renderHeader() +
            renderCover() +
            '<div class="detail-content">' +
            renderInfo() +
            renderAIButtons() +
            renderRatings() +
            renderComments() +
            '</div>' +
            renderFavoriteBtn() +
            '</div>';
    }

    // ==================== 事件处理 ====================
    function init(params) {
        console.log('[detail.js] init 被调用');
        // 清理可能残留的弹窗（从 body 移除）
        var modal = document.getElementById('rule-modal');
        if (modal) modal.remove();
        state.showRuleModal = false;
        state.ruleLoading = false;
        // 优先使用 params 中的 id，其次从 URL hash 解析
        if (params && params.id) {
            state.gameId = params.id;
        } else {
            state.gameId = getGameIdFromHash();
        }
        
        if (!state.gameId) {
            console.error('[detail.js] 无法获取游戏ID!');
            state.loadError = '无法获取游戏ID';
            state.isLoading = false;
            window.detailPageRender();
            return;
        }
        
        // 显示加载状态
        state.isLoading = true;
        state.loadError = null;
        window.detailPageRender();
        
        // 从 Supabase 加载游戏数据
        loadGameFromDB(state.gameId);
    }

    // 从数据库加载游戏详情
    async function loadGameFromDB(id) {
        console.log('[detail.js] 准备从数据库加载游戏, ID:', id);
        
        try {
            if (typeof window.getGameDetail !== 'function') {
                throw new Error('API 未加载');
            }
            
            console.log('[detail.js] 调用 window.getGameDetail()');
            var game = await window.getGameDetail(id);
            console.log('[detail.js] getGameDetail 返回:', game != null ? (game.name || '(无name)') : 'null');
            
            // Bug 2 修复：getGameDetail 可能返回 {} 空对象（truthy 但无有效数据），验证有效性
            if (game && !game.name && !game.game_name) {
                console.warn('[detail.js] getGameDetail 返回无效对象（无name），视为null继续fallback');
                game = null;
            }
            
            if (!game) {
                // 尝试全局桌游接口
                if (typeof window.getGlobalGame === 'function') {
                    console.log('[detail.js] 尝试全局桌游接口');
                    game = await window.getGlobalGame(id);
                    console.log('[detail.js] getGlobalGame 返回:', game != null ? (game.name || '(无name)') : 'null');
                    // 同样检查有效性
                    if (game && !game.name && !game.game_name) {
                        console.warn('[detail.js] getGlobalGame 返回无效对象（无name），视为null');
                        game = null;
                    }
                }
            }
            
            if (game) {
                state.game = game;
                state.isLoading = false;
                state.loadError = null;
                console.log('[detail.js] 加载成功:', game.name);
            } else {
                state.game = null;
                state.isLoading = false;
                state.loadError = '游戏不存在 (ID: ' + id + ')';
                console.error('[detail.js] 游戏不存在');
            }
        } catch (error) {
            console.error('[detail.js] 加载失败:', error);
            state.game = null;
            state.isLoading = false;
            state.loadError = error.message || '加载失败';
        }
        
        window.detailPageRender();
    }

    function goBack() {
        // Bug 4 修复：回到上一页，而非总是跳转首页
        var prevPage = sessionStorage.getItem('prevPageBeforeDetail');
        if (prevPage) {
            sessionStorage.removeItem('prevPageBeforeDetail');
            window.location.hash = prevPage;
        } else {
            // 兜底：优先用浏览器历史
            try {
                if (window.history.length > 1) {
                    window.history.back();
                    return;
                }
            } catch(e) {}
            window.location.hash = '/home';
        }
    }

    function toggleDesc() {
        state.descExpanded = !state.descExpanded;
        window.detailPageRender();
    }

    function goChat(mode) {
        sessionStorage.setItem('chatFrom', '/detail?id=' + state.gameId);
        window.location.hash = '/chat?gameId=' + state.gameId + '&mode=' + mode;
    }

    function toggleFavorite() {
        state.isFavorite = !state.isFavorite;
        window.detailPageRender();
    }

    function writeComment() {
        alert('评论功能即将上线！');
    }

    // 导出页面对象
    var page = {
        render: render,
        init: init,
        goBack: goBack,
        toggleDesc: toggleDesc,
        goChat: goChat,
        toggleFavorite: toggleFavorite,
        writeComment: writeComment,
        // 规则速查（只读查看）
        showRules: showRules,
        closeRules: closeRules,
        goAskAI: goAskAI,
        toggleRuleSection: toggleRuleSection,
        renderDefaultCover: renderDefaultCover
    };

    // 全局暴露
    window.detailPage = page;
    window.detailPageRender = function() {
        if (window._activePage !== 'detail') return;
        var app = document.getElementById('app');
        if (app) {
            app.innerHTML = (window.renderShopHeader ? window.renderShopHeader() : '') + page.render();
            window.bindTabBarEvents();
            // 注意：不在这里调用 init()，避免无限递归
        }
    };

    return page;
})());
