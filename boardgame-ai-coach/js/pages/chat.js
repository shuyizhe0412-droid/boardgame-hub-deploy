/**
 * 桌游AI教练 - AI对话页
 */
App.registerPage('chat', (function() {
    // ==================== 店家欢迎语辅助 ====================
    // 欢迎语和预设问题是两个独立的部分：
    // - 欢迎语：有店家 → 显示店家专属欢迎语（含游戏名），无店家 → 显示游戏原有欢迎语
    // - 预设问题：始终根据游戏 category 动态生成，不受店家模式影响
    function getShopWelcome(gameName) {
        var shopInfo = window._shopInfo;
        if (!shopInfo || !shopInfo.name) return null;
        if (gameName) {
            return '欢迎来到' + shopInfo.name + '！让我们一起来学习' + gameName + '的规则。';
        }
        return '欢迎来到' + shopInfo.name + '！我是你的AI桌游助手，告诉我你想学哪款游戏的规则。';
    }

    function getWelcomeText(modeInfo, gameName) {
        var sw = getShopWelcome(gameName);
        if (sw) return sw;
        return modeInfo.welcome(gameName);
    }

    // ==================== 模式配置 ====================
    var modeConfig = {
        'setup': {
            name: '摆盘引导',
            icon: '🎯',
            welcome: function(gameName) {
                return '你好！我是你的摆盘助手。请告诉我你们有几个人玩，我来一步步教你摆放' + gameName + '的配件。';
            },
            // 预设问题会根据游戏类型动态生成
            quickQuestions: []
        },
        'rules': {
            name: '规则教学',
            icon: '📖',
            welcome: function(gameName) {
                return '你好！让我们一起来学习' + gameName + '的规则。你可以随时问我任何问题，我们一步一步来。';
            },
            quickQuestions: []
        },
        'faq': {
            name: '规则速查',
            icon: '🔍',
            welcome: function(gameName) {
                return '你好！你想查' + gameName + '的什么规则？直接问我就行。';
            },
            quickQuestions: []
        },
        'recommend': {
            name: 'AI推荐',
            icon: '🤔',
            welcome: function() {
                return '你好！我是桌游推荐助手。告诉我你们几个人玩？喜欢什么类型的游戏？我来帮你挑选最合适的桌游！';
            },
            quickQuestions: ['几人玩？', '玩多久？', '喜欢什么类型？'],
            placeholder: '告诉我你想玩什么类型的...'
        },
        'quick': {
            name: '规则速查',
            icon: '⚡',
            welcome: function() {
                return '你好！我是桌游规则速查助手。直接告诉我你想查哪款桌游的什么规则，我快速给你答案。';
            },
            quickQuestions: ['卡坦岛怎么交易？', '狼人杀各角色能力？', 'UNO能连出吗？'],
            placeholder: '输入游戏名称或规则问题...'
        }
    };

    // ==================== 游戏类型预设问题配置 ====================
    // 根据 tags 和 category 判断游戏类型，返回对应的预设问题
    // 匹配优先级（按顺序）：tags 优先，category 作为兜底
    function getQuestionsByGameType(mode, category, tags) {
        category = category || '';
        tags = tags || [];

        // 辅助函数：精确匹配 tags 中是否包含指定关键字
        function hasTag(keywords) {
            return tags.some(function(tag) {
                return keywords.indexOf(tag) !== -1;
            });
        }

        // 兜底：通用问题
        var questions = ['几人能玩？', '游戏流程？', '怎么赢？', '核心规则？'];

        // 规则1：tags包含"社交"或"推理" → 推理阵营类
        if (hasTag(['社交', '推理'])) {
            questions = ['几人能玩？', '角色分配？', '怎么投票？', '怎么赢？'];
        }
        // 规则2：tags包含"卡牌" → 卡牌类
        else if (hasTag(['卡牌'])) {
            questions = ['几人能玩？', '怎么发牌？', '出牌规则？', '怎么赢？'];
        }
        // 规则3：tags包含"派对" → 派对类
        else if (hasTag(['派对'])) {
            questions = ['几人能玩？', '怎么玩？', '计分规则？', '怎么赢？'];
        }
        // 规则4：tags包含"策略" 或 category是"medium"/"german" → 策略类
        else if (hasTag(['策略']) || category === 'medium' || category === 'german') {
            questions = ['几个人玩？', '地图怎么摆？', '资源怎么算？', '怎么赢？'];
        }
        // 规则5/6：category是"beginner"或其他兜底 → 入门/通用问题（已在默认值中）

        console.log('[chat.js] getQuestionsByGameType - mode:', mode, 'category:', category, 'tags:', tags, 'result:', questions);
        return questions;
    }

    // 语言风格配置
    var styleConfig = {
        'teacher': { icon: '👨‍🏫', name: '正经老师', prefix: '【老师模式】' },
        'friend': { icon: '🤗', name: '热情朋友', prefix: '【朋友模式】' },
        'dict': { icon: '📖', name: '简洁字典', prefix: '【字典模式】' }
    };

    // ==================== 全局会话存储 ====================
    // 按 key = `${gameId}_${mode}` 隔离每个游戏+模式的对话
    var chatSessions = {};

    // 获取或创建会话
    function getSession(gameId, mode, gameName) {
        var key = gameId + '_' + mode;
        if (!chatSessions[key]) {
            chatSessions[key] = {
                gameId: gameId,
                mode: mode,
                gameName: gameName,     // 每个会话独立保存游戏名
                gameData: null,         // 保存完整游戏数据
                messages: [],           // 消息列表
                style: 'teacher',       // 语言风格也按会话独立
                welcomeSent: false,     // 是否已发送欢迎语
                loaded: false           // 是否已加载游戏数据
            };
        }
        return chatSessions[key];
    }

    // ==================== 当前页面状态（指向当前会话） ====================
    var state = {
        mode: 'setup',
        gameId: '',
        gameName: '加载中...',
        session: null,   // 当前会话引用
        inputText: '',
        isTyping: false  // AI 正在输入中
    };

    // ==================== 语音相关状态 ====================
    // voiceState 已移除（语音功能暂不启用）

    // ==================== 工具函数 ====================
    function getParamFromHash(key) {
        var hash = window.location.hash || '';
        var match = hash.match(new RegExp('[?&]' + key + '=([^&]+)'));
        return match ? decodeURIComponent(match[1]) : null;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/\n/g, '<br>');
    }

    // 格式化AI回复：将 **XX** 和 *XX* 替换为 [XX]，再做HTML转义
    function formatAIMessage(text) {
        if (!text) return '';
        // 将 **XX** 替换为 [XX]
        text = text.replace(/\*\*(.*?)\*\*/g, '[$1]');
        // 将 *XX* 替换为 [XX]（单星号也处理）
        text = text.replace(/\*(.*?)\*/g, '[$1]');
        // HTML转义 + 换行转<br>
        return escapeHtml(text);
    }

    // ==================== 从Supabase加载游戏数据 ====================
    async function loadGameData(gameId) {
        console.log('[chat.js] 准备加载游戏数据, gameId:', gameId);
        
        try {
            if (typeof window.getGameDetail !== 'function') {
                throw new Error('API 未加载');
            }
            
            var gameData = await window.getGameDetail(gameId);
            console.log('[chat.js] 游戏数据:', gameData);
            
            if (gameData) {
                // 确保使用正确的 name 字段
                var gameName = gameData.name;
                console.log('[chat.js] 游戏名称 (name字段):', gameName);
                console.log('[chat.js] 游戏分类 (category字段):', gameData.category);
                console.log('[chat.js] 游戏标签 (tags字段):', gameData.tags);
                
                // 更新会话中的游戏数据
                if (state.session) {
                    state.session.gameData = gameData;
                    state.session.gameName = gameName || '未知游戏';
                    state.session.loaded = true;
                    state.gameName = gameName || '未知游戏';
                }
                return gameData;
            } else {
                throw new Error('游戏不存在');
            }
        } catch (error) {
            console.error('[chat.js] 加载游戏数据失败:', error);
            // 使用默认名称
            if (state.session) {
                state.session.gameName = '游戏';
                state.session.loaded = true;
            }
            state.gameName = '游戏';
            return null;
        }
    }

    // 发送消息到 AI 并获取回复（调用后端 /api/ai/ask）
    async function sendToAI(userMessage) {
        var session = state.session;

        // 构建历史消息（多轮记忆）
        var history = [];
        if (session && session.messages) {
            for (var i = 0; i < session.messages.length; i++) {
                var msg = session.messages[i];
                if (msg.role === 'user' || msg.role === 'assistant') {
                    history.push({ role: msg.role, content: msg.content });
                }
            }
        }

        // 流式接收 - 先用 typing 指示器占位，收到首块内容后再添加气泡
        state.isTyping = true;
        refreshMessages();
        var aiMessageAdded = false;
        var aiIndex = -1;
        var mode = state.currentMode || 'rules';
        window.askAIStream(state.gameId, userMessage, mode, history, function(chunk) {
            // 首块内容到达：移除 typing 指示器，添加AI消息气泡
            if (!aiMessageAdded) {
                aiMessageAdded = true;
                state.isTyping = false;
                session.messages.push({ role: 'assistant', content: '' });
                aiIndex = session.messages.length - 1;
                refreshMessages();
            }
            // 每收到一块内容，更新 AI 消息
            session.messages[aiIndex].content += chunk;
            // 更新 DOM 中的气泡
            var bubbles = document.querySelectorAll('.chat-bubble-ai');
            var lastBubble = bubbles[bubbles.length - 1];
            if (lastBubble) {
                lastBubble.innerHTML = formatAIMessage(session.messages[aiIndex].content);
                var messagesEl = document.getElementById('chat-messages');
                if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
            }
        }).then(function(fullText) {
            state.isTyping = false;
            session.messages[aiIndex].content = fullText;
            refreshMessages();

            // 自动朗读已移除
        }).catch(function(error) {
            console.error('AI 回复失败:', error);
            state.isTyping = false;
            session.messages[aiIndex].content = 'AI暂时无法回答，请稍后再试';
            refreshMessages();
        });
    }

    // ==================== 渲染函数 ====================
    // 渲染顶部栏
    function renderHeader() {
        var session = state.session;
        var modeInfo = modeConfig[session.mode];
        var styleInfo = styleConfig[session.style];
        return '<div class="chat-header">' +
            '<span class="chat-back" onclick="chatPage.goBack()">← 返回</span>' +
            '<span class="chat-mode-name">' + modeInfo.icon + ' ' + modeInfo.name + '</span>' +
            '<span class="chat-style-btn" onclick="chatPage.toggleStyle()" title="' + styleInfo.name + '">' + styleInfo.icon + '</span>' +
            '</div>';
    }

    // 渲染消息气泡
    function renderMessage(msg, index) {
        if (msg.role === 'user') {
            return '<div class="chat-message chat-message-user">' +
                '<div class="chat-bubble chat-bubble-user">' + escapeHtml(msg.content) + '</div>' +
                '</div>';
        } else {
            return '<div class="chat-message chat-message-ai">' +
                '<div class="chat-avatar">🤖</div>' +
                '<div class="chat-bubble chat-bubble-ai">' + formatAIMessage(msg.content) +
                '</div>' +
                '</div>';
        }
    }

    // 渲染加载动画（手机上 Edge Function 可能走超时降级，提示用户稍等）
    function renderTypingIndicator() {
        return '<div class="chat-message chat-message-ai" id="chat-typing">' +
            '<div class="chat-avatar">🤖</div>' +
            '<div class="chat-bubble chat-bubble-ai chat-typing-indicator">' +
            '<span class="chat-dot"></span><span class="chat-dot"></span><span class="chat-dot"></span>' +
            '<span class="chat-typing-text">AI正在思考，请稍候...</span>' +
            '</div>' +
            '</div>';
    }

    // 渲染聊天消息区域
    function renderMessages() {
        var session = state.session;
        var modeInfo = modeConfig[session.mode];
        var html = '<div class="chat-messages" id="chat-messages">';

        if (session.messages.length === 0) {
            // 无消息时显示欢迎语（店家模式 → 店家欢迎语，否则 → 游戏原有欢迎语）
            html += '<div class="chat-message chat-message-ai">' +
                '<div class="chat-avatar">🤖</div>' +
                '<div class="chat-bubble chat-bubble-ai">' + formatAIMessage(getWelcomeText(modeInfo, state.gameName)) + '</div>' +
                '</div>';
        } else {
            session.messages.forEach(function(msg, i) {
                html += renderMessage(msg, i);
            });
        }

        if (state.isTyping) {
            html += renderTypingIndicator();
        }

        html += '</div>';
        return html;
    }

    // 渲染快捷问题（欢迎语和预设问题是独立的：店家模式只影响欢迎语，不影响预设问题分类）
    function renderQuickQuestions() {
        var session = state.session;
        var mode = session.mode;

        // recommend / quick 模式使用modeConfig中的固定预设（无需 gameData）
        var modeInfo = modeConfig[mode];
        if (modeInfo && modeInfo.quickQuestions && modeInfo.quickQuestions.length > 0) {
            var html = '<div class="chat-quick-questions">' +
                '<div class="chat-quick-scroll">';
            modeInfo.quickQuestions.forEach(function(q) {
                html += '<button class="chat-quick-btn" onclick="chatPage.sendQuick(\'' + escapeHtml(q) + '\')">' + q + '</button>';
            });
            html += '</div></div>';
            return html;
        }

        // 游戏数据未加载完成时不显示预设问题，避免出现错误的通用问题
        // 等 loadGameData 完成后会通过 refreshQuickQuestions() 更新为正确的分类问题
        if (!session.gameData) {
            console.log('[chat.js] renderQuickQuestions - gameData 未加载，延迟显示预设问题');
            return '<div class="chat-quick-questions chat-quick-pending"></div>';
        }

        // 根据游戏类型动态获取预设问题（不受店家模式影响）
        var category = session.gameData.category || '';
        var tags = session.gameData.tags || [];
        var questions = getQuestionsByGameType(mode, category, tags);
        console.log('[chat.js] renderQuickQuestions - mode:', mode, 'category:', category, 'tags:', tags, 'questions:', questions);

        var html = '<div class="chat-quick-questions">' +
            '<div class="chat-quick-scroll">';

        questions.forEach(function(q) {
            html += '<button class="chat-quick-btn" onclick="chatPage.sendQuick(\'' + escapeHtml(q) + '\')">' + q + '</button>';
        });

        html += '</div></div>';
        return html;
    }

    // 渲染底部输入区域
    function renderInputArea() {
        var session = state.session;
        var modeInfo = modeConfig[session.mode];
        var placeholder = (modeInfo && modeInfo.placeholder) ? modeInfo.placeholder : '输入你的问题...';
        return '<div class="chat-input-area">' +
            renderQuickQuestions() +
            '<div class="chat-input-row">' +
            '<input type="text" class="chat-input" id="chat-input" ' +
            'placeholder="' + placeholder + '" value="' + escapeHtml(state.inputText) + '" ' +
            'onkeydown="chatPage.handleKeyDown(event)">' +
            '<button class="chat-send-btn" onclick="chatPage.sendMessage()">➤</button>' +
            '</div>' +
            '</div>';
    }

    // 主渲染函数
    function render(params) {
        // 解析 mode 和 gameId（兼容 id / gameId 两种参数名）
        var rawMode = (params && params.mode) ? params.mode : (getParamFromHash('mode') || '');
        // 如果 mode 是 setup/rules/faq 则直接使用，否则默认 setup（有gameId时）；如果无gameId则用 rawMode
        var gameId = (params && params.gameId) ? params.gameId :
                     (params && params.id) ? params.id :
                     (getParamFromHash('gameId') || getParamFromHash('id') || '');

        var mode;
        if (gameId) {
            // 有 gameId：有效教学模式
            mode = (rawMode === 'setup' || rawMode === 'rules' || rawMode === 'faq') ? rawMode : 'setup';
        } else {
            // 无 gameId：推荐/速查模式（来自入口页卡片2/3）
            mode = (rawMode === 'recommend' || rawMode === 'quick') ? rawMode : 'setup';
        }

        console.log('[chat.js] render - mode:', mode, 'gameId:', gameId, 'params:', params);

        state.mode = mode;
        state.gameId = gameId;

        // 无 gameId 的模式使用固定名称
        var sessionGameName = '';
        if (!gameId) {
            var modeInfo = modeConfig[mode];
            sessionGameName = modeInfo ? modeInfo.name : 'AI助手';
        } else {
            sessionGameName = (state.session ? state.session.gameName : '加载中...');
        }

        // 获取或创建对应会话
        state.session = getSession(gameId, mode, sessionGameName);

        return '<div class="chat-page">' +
            renderHeader() +
            '<div class="chat-body">' +
            renderMessages() +
            '</div>' +
            renderInputArea() +
            '</div>';
    }

    // ==================== 事件处理 ====================
    function init(params) {
        console.log('[chat-debug] 1. init 开始, params:', JSON.stringify(params));

        var session = state.session;
        if (!session) {
            console.error('[chat-debug] 1a. session 不存在，退出');
            return;
        }
        console.log('[chat-debug] 1b. session 存在, mode:', session.mode, 'gameId:', session.gameId, 'shopId 来源:', (window._shopInfo && window._shopInfo.id) || sessionStorage.getItem('shopId') || null);

        // 无 gameId 的模式（推荐/速查）：跳过加载游戏数据
        if (!state.gameId) {
            console.log('[chat-debug] 2. 无 gameId，跳过数据加载 + logScan，模式:', state.mode);
            session.loaded = true;

            // 首次进入该会话，发送欢迎语（店家模式 → 店家欢迎语，否则 → 游戏原有欢迎语）
            if (!session.welcomeSent && session.messages.length === 0) {
                session.welcomeSent = true;
                var modeInfo = modeConfig[session.mode];
                session.messages.push({
                    role: 'assistant',
                    content: getWelcomeText(modeInfo, session.gameName)
                });
            }

            refreshMessages();
            refreshQuickQuestions();

            setTimeout(function() {
                var input = document.getElementById('chat-input');
                if (input) {
                    input.focus();
                }
                scrollToBottom();
            }, 100);
            return;
        }

        console.log('[chat-debug] 3. 有 gameId，准备加载游戏数据, gameId:', state.gameId);

        // 异步加载游戏数据
        loadGameData(state.gameId).then(function(gameData) {
            console.log('[chat-debug] 4. gameData 加载完成:', gameData ? (gameData.name || 'name为空') : 'null');

            // 首次进入该会话，发送欢迎语（店家模式 → 店家欢迎语，否则 → 游戏原有欢迎语）
            if (!session.welcomeSent && session.messages.length === 0) {
                session.welcomeSent = true;
                var modeInfo = modeConfig[session.mode];
                session.messages.push({
                    role: 'assistant',
                    content: getWelcomeText(modeInfo, session.gameName)
                });
            }

            console.log('[chat-debug] 5. 欢迎消息已处理, welcomeSent:', session.welcomeSent, '消息数:', session.messages.length);

            // 刷新消息显示和快捷问题
            try {
                refreshMessages();
                console.log('[chat-debug] 6a. refreshMessages 完成');
            } catch(e) {
                console.error('[chat-debug] 6a. refreshMessages 异常:', e);
            }
            try {
                refreshQuickQuestions();
                console.log('[chat-debug] 6b. refreshQuickQuestions 完成');
            } catch(e) {
                console.error('[chat-debug] 6b. refreshQuickQuestions 异常:', e);
            }

            // 记录扫码（每次进入AI对话页都记录）
            console.log('[chat-debug] 7. 准备 logScan, gameData存在:', !!gameData, 'gameData.id:', gameData ? gameData.id : 'null');
            if (gameData && gameData.id) {
                var shopId = (window._shopInfo && window._shopInfo.id) || sessionStorage.getItem('shopId') || null;
                console.log('[chat-debug] 8. logScan 参数, shopId:', shopId, 'gameId:', gameData.id);
                if (shopId) {
                    try {
                        if (typeof window.logScan === 'function') {
                            window.logScan(shopId, gameData.id);
                            console.log('[chat-debug] 9. logScan 已调用');
                        } else {
                            console.error('[chat-debug] 9. window.logScan 不是一个函数, typeof:', typeof window.logScan);
                        }
                    } catch(e) {
                        console.error('[chat-debug] 9. logScan 调用异常:', e);
                    }
                } else {
                    console.warn('[chat-debug] 9. shopId 为空，跳过 logScan');
                }
            } else {
                console.warn('[chat-debug] 8. gameData 为空或无 id，跳过 logScan');
            }

            console.log('[chat-debug] 10. init 完成');

            // 初始化输入框
            setTimeout(function() {
                var input = document.getElementById('chat-input');
                if (input) {
                    input.focus();
                    var len = input.value.length;
                    input.setSelectionRange(len, len);
                }
                scrollToBottom();
            }, 100);
        }).catch(function(err) {
            console.error('[chat-debug] 4. loadGameData promise 被拒绝:', err);
        });
    }

    // 刷新快捷问题（加载完游戏数据后调用）
    function refreshQuickQuestions() {
        var container = document.querySelector('.chat-quick-questions');
        if (container) {
            container.outerHTML = renderQuickQuestions();
        }
    }

    function goBack() {
        var from = sessionStorage.getItem('chatFrom');
        if (from === 'chat-list') {
            // 从 AI 入口页进入 → 回到入口页
            window.location.hash = '/chat';
        } else if (from && from.indexOf('/detail') === 0) {
            // 从游戏详情页进入 → 回到详情页
            window.location.hash = from;
        } else if (state.gameId && (state.mode === 'setup' || state.mode === 'rules' || state.mode === 'faq')) {
            // 有 gameId 的教学模式 → 回详情页
            window.location.hash = '/detail?id=' + state.gameId;
        } else {
            // 默认回 AI 入口
            window.location.hash = '/chat';
        }
    }

    function toggleStyle() {
        var session = state.session;
        var styles = ['teacher', 'friend', 'dict'];
        var currentIndex = styles.indexOf(session.style);
        session.style = styles[(currentIndex + 1) % styles.length];
        window.chatPageRender();
    }

    function sendMessage() {
        var input = document.getElementById('chat-input');
        if (!input) return;

        var text = input.value.trim();
        if (!text) return;

        var session = state.session;

        // 添加用户消息到当前会话
        session.messages.push({
            role: 'user',
            content: text
        });

        input.value = '';
        state.inputText = '';

        refreshMessages();
        simulateAIResponse(text);
    }

    function sendQuick(question) {
        var session = state.session;

        session.messages.push({
            role: 'user',
            content: question
        });

        refreshMessages();
        simulateAIResponse(question);
    }

    function simulateAIResponse(userMessage) {
        state.isTyping = true;
        appendTypingIndicator();
        sendToAI(userMessage);
    }

    function handleKeyDown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    }

    // ==================== 辅助函数 ====================
    function refreshMessages() {
        var session = state.session;
        var messagesEl = document.getElementById('chat-messages');
        if (!messagesEl) return;

        messagesEl.innerHTML = '';

        if (session.messages.length === 0) {
            var modeInfo = modeConfig[session.mode];
            var welcomeText = state.gameId ? getWelcomeText(modeInfo, session.gameName) : getWelcomeText(modeInfo, '');
            messagesEl.innerHTML = '<div class="chat-message chat-message-ai">' +
                '<div class="chat-avatar">🤖</div>' +
                '<div class="chat-bubble chat-bubble-ai">' + formatAIMessage(welcomeText) + '</div>' +
                '</div>';
        } else {
            session.messages.forEach(function(msg, i) {
                messagesEl.innerHTML += renderMessage(msg, i);
            });
        }

        if (state.isTyping) {
            messagesEl.innerHTML += renderTypingIndicator();
        }

        scrollToBottom();
    }

    function appendTypingIndicator() {
        var messagesEl = document.getElementById('chat-messages');
        if (messagesEl) {
            messagesEl.innerHTML += renderTypingIndicator();
            scrollToBottom();
        }
    }

    function scrollToBottom() {
        setTimeout(function() {
            var messagesEl = document.getElementById('chat-messages');
            if (messagesEl) {
                messagesEl.scrollTop = messagesEl.scrollHeight;
            }
        }, 50);
    }

    // ==================== 导出页面对象 ====================
    var page = {
        render: render,
        init: init,
        goBack: goBack,
        toggleStyle: toggleStyle,
        sendMessage: sendMessage,
        sendQuick: sendQuick,
        handleKeyDown: handleKeyDown,

    };

    // 全局暴露
    window.chatPage = page;
    window.chatPageRender = function() {
        if (window._activePage !== 'chat') {
            return;
        }
        var app = document.getElementById('app');
        if (app) {
            app.innerHTML = (window.renderShopHeader ? window.renderShopHeader() : '') + page.render();
            window.bindTabBarEvents();
            page.init();
        }
    };

    return page;
})());
