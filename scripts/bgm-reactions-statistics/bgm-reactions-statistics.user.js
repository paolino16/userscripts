// ==UserScript==
// @name         bgm_reactions_statistics
// @description  BGM时间线点赞统计 - 自动获取并展示被点赞内容 (修复死循环 + 兼容chii.in)
// @license      MIT
// @namespace    sqrtwo
// @version      4.3
// @author       徒手开根号二 (重构版 + 死循环修复 + chii.in兼容)
// @match        https://bgm.tv/*
// @match        https://bangumi.tv/*
// @match        https://chii.in/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      next.bgm.tv
// @connect      bgm.tv
// @connect      api.bgm.tv
// @connect      chii.in
// @run-at       document-idle
// @unwrap
// ==/UserScript==

(function() {
    'use strict';

    // ====================== 常量定义 ======================
    const LOCAL_STORAGE_KEY = "BGM_REACTIONS_DATA";
    const API_BASE_URL = "https://next.bgm.tv/p1/users/";
    const FETCH_LIMIT = 20; // API每次请求的最大数量
    const MAX_REQUEST_PAGES = 100; // 最大请求页数（防止死循环）
    const MAX_CONSECUTIVE_EMPTY = 3; // 最大连续空页数
    const REACTION_EMOJI_MAP = {
        0: "bgm67",
        54: "bgm38",
        104: "bgm88",
        140: "bgm124",
        122: "bgm106",
        90: "bgm74",
        88: "bgm72",
        80: "bgm64",
    };
    const REACTION_SMILE_URLS = {
        0: "https://bgm.tv/img/smiles/tv/44.gif",
        54: "https://bgm.tv/img/smiles/tv/15.gif",
        80: "https://bgm.tv/img/smiles/tv/41.gif",
        88: "https://bgm.tv/img/smiles/tv/49.gif",
        90: "https://bgm.tv/img/smiles/tv/51.gif",
        104: "https://bgm.tv/img/smiles/tv/65.gif",
        122: "https://bgm.tv/img/smiles/tv/83.gif",
        140: "https://bgm.tv/img/smiles/tv/101.gif"
    };
    let CANCEL_UPDATE = false;

    // ====================== 兼容性处理 - 核心修复 ======================
    function getGMHttpRequest() {
        // 1. 优先用回调版GM_xmlhttpRequest（Tampermonkey）
        if (typeof GM_xmlhttpRequest !== 'undefined') {
            return function(options) {
                return new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        ...options,
                        onload: (res) => resolve(res),
                        onerror: (err) => reject(err),
                        ontimeout: () => reject(new Error('请求超时')),
                        onabort: () => reject(new Error('请求被中止'))
                    });
                });
            };
        }
        // 2. 兼容Promise版GM.xmlHttpRequest（Violentmonkey）
        else if (typeof GM !== 'undefined' && typeof GM.xmlHttpRequest !== 'undefined') {
            return GM.xmlHttpRequest;
        }
        // 3. 降级方案：普通fetch（仅兜底，可能有CORS）
        else {
            return function(options) {
                return fetch(options.url, {
                    method: options.method || 'GET',
                    headers: options.headers || {},
                    mode: 'cors',
                    timeout: options.timeout || 10000
                }).then(response => {
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    return {
                        status: response.status,
                        statusText: response.statusText,
                        responseText: response.text()
                    };
                });
            };
        }
    }

    const gmRequest = getGMHttpRequest();

    // ====================== 样式添加 ======================
    function addStyle() {
        const style = document.createElement('style');
        style.innerHTML = `
            :target {
                animation: target-fade 1s;
            }
            @keyframes target-fade {
                from { background-color: white; }
                to { background-color: transparent; }
            }
            .reaction_stat_container {
                max-width: 1000px;
                margin: 20px auto;
                padding: 0 6px 20px;
            }
            #reaction_tabs {
                display: flex;
                gap: 8px;
                margin-bottom: 12px;
                border-bottom: 1px solid #e8e8e8;
                padding-bottom: 8px;
            }
            html[data-theme='dark'] #reaction_tabs {
                border-bottom: 1px solid #444;
            }
            #reaction_tabs a {
                padding: 6px 12px;
                cursor: pointer;
                border-radius: 4px;
                text-decoration: none;
                color: #666;
                background: linear-gradient(#fcfcfc, #f1f1f1);
                border: 1px solid #ddd;
                box-shadow: inset 0 1px 0 rgba(255,255,255,0.9);
            }
            html[data-theme='dark'] #reaction_tabs a {
                color: #ccc;
                background: linear-gradient(#505050, #424242);
                border-color: #5a5a5a;
                box-shadow: none;
            }
            #reaction_tabs a:hover {
                color: #333;
                border-color: #cfcfcf;
                background: linear-gradient(#ffffff, #f5f5f5);
            }
            #reaction_tabs a.active {
                background: linear-gradient(#fefefe, #ebebeb);
                color: #333;
                font-weight: bold;
                border-color: #cfcfcf;
            }
            html[data-theme='dark'] #reaction_tabs a.active {
                background: linear-gradient(#616161, #545454);
                color: #fff;
            }
            .reaction_overview {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 12px;
                margin-bottom: 14px;
                padding: 10px 12px;
                background: #fafafa;
                border: 1px solid #e8e8e8;
                border-radius: 5px;
            }
            html[data-theme='dark'] .reaction_overview {
                background: rgba(56,56,56,0.85);
                border-color: #4a4a4a;
            }
            .reaction_summary {
                display: flex;
                flex-wrap: wrap;
                gap: 8px 16px;
                align-items: center;
                color: #666;
                font-size: 12px;
            }
            .reaction_summary strong {
                color: #333;
                font-size: 15px;
                margin-right: 4px;
            }
            html[data-theme='dark'] .reaction_summary {
                color: #aaa;
            }
            html[data-theme='dark'] .reaction_summary strong {
                color: #f0f0f0;
            }
            .reaction_item {
                padding: 14px 16px;
                margin-bottom: 12px;
                border-radius: 5px;
                background: #fcfcfc;
                border: 1px solid #e9e9e9;
                box-shadow: 0 1px 2px rgba(0,0,0,0.03);
            }
            html[data-theme='dark'] .reaction_item {
                background: rgba(60,60,60,0.7);
                border: 1px solid #444;
                box-shadow: none;
            }
            .reaction_item .header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 8px;
                padding-bottom: 8px;
                border-bottom: 1px solid #efefef;
            }
            html[data-theme='dark'] .reaction_item .header {
                border-bottom: 1px solid #555;
            }
            .reaction_item .subject_info {
                flex: 1;
            }
            .reaction_item .subject_title {
                font-size: 16px;
                font-weight: bold;
                margin-bottom: 4px;
            }
            .reaction_item .subject_title a {
                color: #333;
                text-decoration: none;
            }
            html[data-theme='dark'] .reaction_item .subject_title a {
                color: #eee;
            }
            .reaction_item .subject_title a:hover {
                text-decoration: underline;
            }
            .reaction_item .meta_info {
                font-size: 12px;
                color: #999;
                line-height: 1.7;
            }
            html[data-theme='dark'] .reaction_item .meta_info {
                color: #777;
            }
            .reaction_item .subject_subtitle {
                margin-top: 2px;
                font-size: 12px;
                color: #999;
            }
            html[data-theme='dark'] .reaction_item .subject_subtitle {
                color: #7f7f7f;
            }
            .reaction_item .comment_content {
                line-height: 1.6;
                margin: 10px 0;
                padding: 10px;
                background: rgba(255,255,255,0.82);
                border-radius: 4px;
                border: 1px solid rgba(0,0,0,0.05);
            }
            html[data-theme='dark'] .reaction_item .comment_content {
                background: rgba(70,70,70,0.7);
                border-color: rgba(255,255,255,0.06);
            }
            .reaction_item .reactions_list {
                margin-top: 10px;
                padding-top: 10px;
                border-top: 1px dashed #e3e3e3;
            }
            html[data-theme='dark'] .reaction_item .reactions_list {
                border-top: 1px dashed #555;
            }
            .reaction_list_title {
                margin-bottom: 6px;
                color: #666;
                font-size: 12px;
            }
            html[data-theme='dark'] .reaction_list_title {
                color: #aaa;
            }
            .reaction_item .reaction_tag {
                display: inline-block;
                padding: 3px 8px;
                margin: 0 5px 5px 0;
                border-radius: 4px;
                background: #e8f4f8;
                font-size: 12px;
            }
            html[data-theme='dark'] .reaction_item .reaction_tag {
                background: #2d3748;
            }
            .reaction_item .reaction_emoji {
                font-size: 16px;
                margin-right: 5px;
            }
            .no_data {
                text-align: center;
                padding: 40px;
                color: #999;
                font-size: 16px;
            }
            html[data-theme='dark'] .no_data {
                color: #777;
            }
            .loading_container {
                text-align: center;
                padding: 40px;
            }
            .reaction_action_bar {
                margin: 10px 0 0;
            }
            .reaction_text_input {
                padding: 6px 8px;
                width: 180px;
                border: 1px solid #ccc;
                border-radius: 4px;
                background: #fff;
                color: #333;
            }
            .reaction_btn {
                padding: 6px 12px;
                margin-left: 6px;
                cursor: pointer;
                border: 1px solid #ccc;
                border-radius: 4px;
                background: linear-gradient(#fefefe, #efefef);
                color: #333;
            }
            .reaction_btn:hover {
                background: linear-gradient(#ffffff, #f5f5f5);
            }
            html[data-theme='dark'] .reaction_text_input {
                background: #3f3f3f;
                color: #eee;
                border-color: #5b5b5b;
            }
            html[data-theme='dark'] .reaction_btn {
                background: linear-gradient(#5a5a5a, #494949);
                color: #eee;
                border-color: #5b5b5b;
            }
            .loading_spinner {
                border: 4px solid rgba(0,0,0,0.1);
                border-left-color: #333;
                border-radius: 50%;
                width: 40px;
                height: 40px;
                animation: spin 1s linear infinite;
                margin: 0 auto 20px;
            }
            html[data-theme='dark'] .loading_spinner {
                border-left-color: #eee;
            }
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
            .update_time {
                text-align: right;
                font-size: 12px;
                color: #999;
                margin-bottom: 15px;
            }
            html[data-theme='dark'] .update_time {
                color: #777;
            }
            .error_message {
                text-align: center;
                padding: 20px;
                color: #e74c3c;
                background: rgba(231,76,60,0.1);
                border-radius: 4px;
                margin: 10px 0;
            }
            .progress_container {
                margin-top: 6px;
                text-align: center;
            }
            .progress_bar {
                position: relative;
                width: 100%;
                height: 8px;
                background: #eee;
                border-radius: 4px;
                overflow: hidden;
            }
            html[data-theme='dark'] .progress_bar {
                background: #333;
            }
            .progress_fill {
                height: 100%;
                width: 0%;
                background: linear-gradient(90deg, #4e9af1, #42d392);
                transition: width .25s ease;
            }
            .progress_text {
                margin-top: 6px;
                font-size: 12px;
                color: #666;
            }
            html[data-theme='dark'] .progress_text {
                color: #aaa;
            }
            .reaction_item .reaction_group { margin: 4px 14px 4px 0; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; }
            .reaction_item .reaction_icon { display: inline-flex; align-items: center; }
            .reaction_item .reaction_icon img { width: 18px; height: 18px; display: block; }
            .reaction_item .reaction_users { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 0 4px; }
            .reaction_item .reaction_users a { margin-right: 0; }
        `;
        document.head.appendChild(style);
    }
    addStyle();

    // ====================== 工具函数 ======================
    // 获取当前用户信息
    function getUserInfo() {
        try {
            // 获取用户ID
            const userLink = document.querySelector('.idBadgerNeue a.avatar')?.getAttribute('href') ||
                            document.querySelector('#dock li.first a')?.getAttribute('href');
            if (!userLink) return null;

            const uid = userLink.split('/user/')[1];
            const username = uid; // BGM的username通常等于uid

            // 获取用户昵称
            const nickname = document.querySelector('.idBadgerNeue a.avatar img')?.getAttribute('title') ||
                            document.querySelector('.nameSingle')?.textContent ||
                            `用户${uid}`;

            return {
                uid: uid,
                username: username,
                nickname: nickname
            };
        } catch (e) {
            console.log('获取用户信息失败:', e);
            return null;
        }
    }

    // 格式化时间戳
    function formatTimestamp(timestamp) {
        const date = new Date(timestamp * 1000);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }
    function escapeHTML(s) {
        if (s == null) return "";
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    function nl2br(s) {
        return String(s).replace(/\n/g, "<br>");
    }
    function buildReactionSignature(item) {
        if (!item) return "";
        const reactionParts = (item.reactions || []).map(reaction => {
            const userKeys = (reaction.users || [])
                .map(user => `${user.id || ""}:${user.username || ""}:${user.nickname || ""}`)
                .sort();
            return `${reaction.value}|${userKeys.join(",")}`;
        }).sort();
        return [
            item.timeline_id || "",
            item.subject?.id || "",
            item.created_at || 0,
            item.comment || "",
            item.rate || 0,
            reactionParts.join("||")
        ].join("###");
    }
    function shouldReplaceReactionEntry(prev, next) {
        if (!prev) return true;
        if (!next) return false;
        if ((next.created_at || 0) > (prev.created_at || 0)) return true;
        if ((next.timeline_id || 0) !== (prev.timeline_id || 0)) return (next.timeline_id || 0) > (prev.timeline_id || 0);
        return buildReactionSignature(next) !== buildReactionSignature(prev);
    }
    function mergeReactionItems(items) {
        const dedup = {};
        for (const item of items) {
            const sid = item.subject?.id;
            if (!sid) continue;
            const prev = dedup[sid];
            if (shouldReplaceReactionEntry(prev, item)) {
                dedup[sid] = item;
            }
        }
        return Object.values(dedup).sort((a, b) => {
            const aTime = a.created_at || 0;
            const bTime = b.created_at || 0;
            if (bTime !== aTime) return bTime - aTime;
            return (b.timeline_id || 0) - (a.timeline_id || 0);
        });
    }

    // 获取表情符号
    function getReactionEmoji(value) {
        return REACTION_EMOJI_MAP[value] || `[表情${value}]`;
    }
    function getReactionIconHTML(value) {
        const url = REACTION_SMILE_URLS[value];
        if (url) {
            return `<img class="reaction_smile" src="${url}" alt="${value}">`;
        }
        const e = getReactionEmoji(value);
        return `<span class="reaction_emoji">${e}</span>`;
    }

    // ====================== 本地存储操作 ======================
    // 初始化本地存储
    function initLocalStorage() {
        let data = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '{}');
        const userInfo = getUserInfo();

        if (!userInfo || !userInfo.uid) return data;

        if (!data[userInfo.uid]) {
            data[userInfo.uid] = {
                last_update: 0,
                total_reactions: 0,
                reactions_data: [],
                all_timeline_ids: [],
                last_max_id_seen: 0
            };
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
        }

        return data;
    }

    // 保存数据到本地存储
    function saveToLocalStorage(reactionsData, allTimelineIds, lastMaxIdSeen) {
        const userInfo = getUserInfo();
        if (!userInfo || !userInfo.uid) return;

        const data = initLocalStorage();
        const merged = mergeReactionItems(reactionsData);

        data[userInfo.uid] = {
            last_update: Date.now(),
            total_reactions: merged.length,
            reactions_data: merged,
            all_timeline_ids: allTimelineIds.slice(-1000),
            last_max_id_seen: Math.max(lastMaxIdSeen || 0, data[userInfo.uid]?.last_max_id_seen || 0)
        };

        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
        console.log(`已保存 ${merged.length} 条点赞数据到本地存储`);
    }

    // 从本地存储获取数据
    function getFromLocalStorage() {
        const userInfo = getUserInfo();
        if (!userInfo || !userInfo.uid) return null;

        const data = initLocalStorage();
        return data[userInfo.uid] || null;
    }

    // ====================== API请求 - 彻底修复死循环+Promise兼容 ======================
    const ENABLE_INCREMENTAL = true;
    const ENABLE_BACKFILL = true;
    const BACKFILL_PAGES = 2;
    async function fetchTimelineData(username, opts = {}, onProgress) {
        let allData = [];
        let allIds = [];
        let until = null;
        let pageCount = 0;
        let consecutiveEmpty = 0;
        const existing = getFromLocalStorage();
        const lastMaxIdSeen = existing?.last_max_id_seen || 0;
        const fullRefresh = !!opts.full;
        const userTotalPages = Number(opts.totalPages) || 0;
        let cutoffReached = false;
        let backfillPages = 0;

        while (true) {
            if (typeof onProgress === 'function') {
                try { onProgress(pageCount); } catch (e) {}
            }
            if (CANCEL_UPDATE) {
                console.log(`收到停止指令，终止请求`);
                break;
            }
            // 安全终止条件1：超过最大请求页数
            if (pageCount >= MAX_REQUEST_PAGES) {
                console.log(`[安全限制] 请求页数达到${MAX_REQUEST_PAGES}页，终止请求`);
                break;
            }
            // 用户指定页数上限（仅全量时生效）
            if (fullRefresh && userTotalPages > 0 && pageCount >= userTotalPages) {
                console.log(`[用户设定] 已达到设定页数 ${userTotalPages}，结束抓取`);
                break;
            }

            // 安全终止条件2：连续空页达到上限
            if (consecutiveEmpty >= MAX_CONSECUTIVE_EMPTY) {
                console.log(`[安全限制] 连续${MAX_CONSECUTIVE_EMPTY}页空数据，终止请求`);
                break;
            }

            pageCount++;
            let url = `${API_BASE_URL}${username}/timeline?limit=${FETCH_LIMIT}`;
            if (until) url += `&until=${until}`;

            console.log(`请求API[第${pageCount}页]: ${url}`);

            try {
                // 用await调用Promise版gmRequest（核心修复）
                const response = await gmRequest({
                    method: "GET",
                    url: url,
                    timeout: 10000,
                    headers: {
                        "Accept": "application/json",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "Referer": `${window.location.origin}/`
                    }
                });

                // 检查响应状态
                if (response.status !== 200) {
                    throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
                }

                // 解析响应文本（核心修复：确保responseText是字符串）
                const responseText = typeof response.responseText === 'string'
                    ? response.responseText
                    : await response.responseText; // 兼容fetch的Promise版text()
                const timelineData = JSON.parse(responseText);

                console.log(`[第${pageCount}页] 返回数据量: ${Array.isArray(timelineData) ? timelineData.length : '非数组'}`);

                // 处理空数据
                if (!Array.isArray(timelineData) || timelineData.length === 0) {
                    consecutiveEmpty++;
                    console.log(`第${pageCount}页返回空数据，连续空页数: ${consecutiveEmpty}`);
                    continue;
                }

                // 重置空页计数器
                consecutiveEmpty = 0;

                // 收集数据和ID
                const currentIds = timelineData.map(item => item.id);
                allData.push(...timelineData);
                allIds.push(...currentIds);
                if (ENABLE_INCREMENTAL && !fullRefresh && lastMaxIdSeen) {
                    if (timelineData.some(x => x.id <= lastMaxIdSeen)) {
                        cutoffReached = true;
                    }
                }

                // 判断是否有更多数据
                if (timelineData.length < FETCH_LIMIT) {
                    console.log(`第${pageCount}页数据不足${FETCH_LIMIT}条，已到最后一页`);
                    break;
                }

                // 更新until，准备下一页请求
                until = timelineData[timelineData.length - 1].id;

                if (cutoffReached) {
                    if (ENABLE_BACKFILL && backfillPages < BACKFILL_PAGES) {
                        backfillPages++;
                    } else {
                        console.log(`遇到增量断点，已完成回填${backfillPages}页，停止抓取`);
                        break;
                    }
                }

                // 延迟避免请求过快
                await new Promise(resolve => setTimeout(resolve, 50));

            } catch (error) {
                console.error(`[第${pageCount}页] 请求/解析报错:`, error);
                // 遇到错误不终止，继续尝试下一页（可根据需要调整）
                consecutiveEmpty++;
                continue;
            }
        }

        // 处理所有数据，提取点赞信息
        const reactionsData = processTimelineData(allData);
        const maxId = allIds.length > 0 ? Math.max(...allIds) : 0;
        return { reactions: reactionsData, allIds: allIds, lastMaxIdSeen: maxId };
    }

    // 处理timeline数据，提取点赞信息（仅保留cat=3类型）
    function processTimelineData(timelineData) {
        console.log(`[处理数据] 共${timelineData.length}条timeline数据`);
        const reactionsData = [];

        timelineData.forEach(item => {
            // 只处理cat=3（评论类）且非批量且有reactions的条目
            if (item.cat === 3 && item.batch === false && item.reactions && item.reactions.length > 0) {
                let comment = "";
                let subject = null;
                let rate = 0;

                // 提取评论内容
                if (item.memo && item.memo.subject && item.memo.subject[0]) {
                    comment = item.memo.subject[0].comment || "";
                    subject = item.memo.subject[0].subject;
                    rate = item.memo.subject[0].rate || 0;
                }

                // 过滤掉没有subject的无效数据
                if (!subject) return;

                // 构建点赞信息
                const reactionInfo = {
                    timeline_id: item.id,
                    uid: item.uid,
                    cat: item.cat,
                    type: item.type,
                    comment: comment,
                    rate: rate,
                    subject: subject,
                    created_at: item.createdAt,
                    reactions: item.reactions.map(reaction => ({
                        value: reaction.value,
                        emoji: getReactionEmoji(reaction.value),
                        users: reaction.users.map(user => ({
                            id: user.id,
                            username: user.username,
                            nickname: user.nickname || `用户${user.id}`
                        }))
                    })),
                    total_reaction_users: item.reactions.reduce((total, r) => total + r.users.length, 0)
                };

                reactionsData.push(reactionInfo);
            }
        });

        console.log(`从 ${timelineData.length} 条时间线数据中提取出 ${reactionsData.length} 条cat=3类型的点赞记录`);
        return mergeReactionItems(reactionsData);
    }

    // 全量更新点赞数据
    async function updateReactionsData(forceFull = false, totalPages = 0) {
        const userInfo = getUserInfo();
        if (!userInfo) {
            console.log("无法获取用户信息，跳过数据更新");
            return [];
        }

        try {
            CANCEL_UPDATE = false;
            console.log(`开始获取 ${userInfo.username} 的时间线数据...`);
            const onProgress = (page) => {
                const progress = document.getElementById('reaction_progress');
                if (!progress) return;
                const fill = progress.querySelector('.progress_fill');
                const text = progress.querySelector('.progress_text');
                const total = Number(totalPages) || 0;
                const pct = total > 0 ? Math.max(0, Math.min(99, Math.floor((Math.max(1, page) / total) * 100))) : Math.min(95, page * 5);
                if (fill) fill.style.width = pct + '%';
                if (text) text.textContent = total > 0 ? `已加载第 ${page} / ${total} 页` : `已加载第 ${page} 页`;
            };
            const result = await fetchTimelineData(userInfo.username, { full: !!forceFull, totalPages: Number(totalPages) || 0 }, onProgress);
            const existing = getFromLocalStorage();
            const prev = existing?.reactions_data || [];
            const next = result.reactions || [];
            const merged = mergeReactionItems([...prev, ...next]);

            // 保存到本地存储
            saveToLocalStorage(merged, result.allIds, result.lastMaxIdSeen);

            // 如果当前在展示页面，刷新展示
            if (document.getElementById('reaction_stat_container')) {
                renderReactionsPage();
            }

            return merged;
        } catch (error) {
            console.error("更新点赞数据失败:", error);
            // 显示友好的错误提示
            const contentContainer = document.getElementById('reaction_content');
            if (contentContainer) {
                contentContainer.innerHTML = `
                    <div class="error_message">
                        获取数据失败: ${error}<br>
                        请检查：<br>
                        1. 油猴插件是否启用<br>
                        2. 脚本是否有跨域请求权限<br>
                        3. 网络连接是否正常
                    </div>
                `;
            }
            return [];
        }
    }

    // ====================== 页面渲染 ======================
    // 添加点赞统计标签
    function addReactionTab() {
        // 只在时间线页面添加
        if (!location.pathname.includes('/timeline')) return;

        const tabHtml = '<li><a id="tab_reaction_stat" href="javascript:;">我的点赞统计</a></li>';
        $('#timelineTabs > li:nth-child(2)').after(tabHtml);

        $('#tab_reaction_stat').css('cursor', 'pointer').on('click', function() {
            // 激活当前标签
            $('#timelineTabs a').removeClass('focus');
            $(this).addClass('focus');

            // 显示点赞统计页面
            renderReactionsPage();
        });
    }

    // 渲染点赞统计页面
    function renderReactionsPage() {
        const tmlContent = $('#tmlContent');
        const localData = getFromLocalStorage();
        const totalItems = localData?.reactions_data?.length || 0;
        const totalLikes = (localData?.reactions_data || []).reduce((sum, item) => sum + (item.total_reaction_users || 0), 0);

        // 加载中状态
        tmlContent.html(`
            <div class="reaction_stat_container">
                <div id="reaction_tabs">
                    <a href="javascript:;" class="active" data-tab="all">所有点赞</a>
                    <a href="javascript:;" data-tab="refresh">刷新数据</a>
                    <a href="javascript:;" data-tab="stop">停止更新</a>
                </div>
                <div class="reaction_overview">
                    <div class="reaction_summary">
                        <span><strong>${totalItems}</strong> 条记录</span>
                        <span><strong>${totalLikes}</strong> 个赞</span>
                    </div>
                    <div class="update_time">
                        ${localData ? `最后更新: ${new Date(localData.last_update).toLocaleString()}` : '暂无数据'}
                    </div>
                </div>
                <div id="reaction_content">
                    <div class="loading_container">
                        <div class="loading_spinner"></div>
                        <p>加载中...</p>
                    </div>
                </div>
            </div>
        `);

        // 绑定标签切换事件
        $('#reaction_tabs a').on('click', function() {
            const tabType = $(this).data('tab');
            $('#reaction_tabs a').removeClass('active');
            $(this).addClass('active');

            if (tabType === 'refresh') {
                CANCEL_UPDATE = false;
                $('#reaction_content').html(`
                    <div class="loading_container">
                        <div class="loading_spinner"></div>
                        <p>正在获取最新数据（可在下方输入总页数以确定进度）...</p>
                        <div class="reaction_action_bar">
                            <input id="reaction_total_pages" class="reaction_text_input" type="number" min="1" step="1" placeholder="输入全量页数，如 20">
                            <button id="reaction_start_full" class="reaction_btn">开始</button>
                        </div>
                        <div class="progress_container" id="reaction_progress">
                            <div class="progress_bar">
                                <div class="progress_fill" style="width:0%"></div>
                            </div>
                            <div class="progress_text">已加载第 0 页</div>
                        </div>
                    </div>
                `);
                $('#reaction_start_full').on('click', function() {
                    const totalPagesVal = Number($('#reaction_total_pages').val()) || 0;
                    updateReactionsData(true, totalPagesVal).then(() => {
                        // 拉取完成后将进度条填满
                        const progress = document.getElementById('reaction_progress');
                        if (progress) {
                            const fill = progress.querySelector('.progress_fill');
                            const text = progress.querySelector('.progress_text');
                            if (fill) fill.style.width = '100%';
                            if (text) text.textContent = '已完成';
                        }
                        renderReactionContent('all');
                    });
                });
            } else if (tabType === 'stop') {
                CANCEL_UPDATE = true;
                $('#reaction_content').html(`
                    <div class="no_data">
                        已停止继续请求
                    </div>
                `);
            } else {
                renderReactionContent(tabType);
            }
        });

        // 初始渲染内容
        renderReactionContent('all');
    }

    // 渲染点赞内容
    function renderReactionContent() {
        const contentContainer = $('#reaction_content');
        const localData = getFromLocalStorage();

        if (!localData || localData.reactions_data.length === 0) {
            contentContainer.html(`
                <div class="no_data">
                    暂无点赞数据<br>
                    <button class="reaction_btn" style="margin-top:10px;" onclick="document.querySelector('[data-tab=refresh]').click()">
                        点击获取最新数据
                    </button>
                </div>
            `);
            return;
        }

        const reactionsData = localData.reactions_data;

        reactionsData.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

        let html = '';

        reactionsData.forEach(item => {
            if (!item.subject) return;

            let reactionsHtml = '';
            item.reactions.forEach(reaction => {
                const icon = getReactionIconHTML(reaction.value);
                const usersHtml = reaction.users.map(user => `<a href="${window.location.origin}/user/${user.username}" target="_blank">${user.nickname}</a>`).join('、');
                reactionsHtml += `
                    <div class="reaction_group">
                        <span class="reaction_icon">${icon}</span>
                        <span class="reaction_users">${usersHtml}</span>
                    </div>
                `;
            });

            const safeComment = nl2br(escapeHTML(item.comment || ""));
            const subtitle = item.subject.nameCN && item.subject.nameCN !== item.subject.name
                ? `<div class="subject_subtitle">${escapeHTML(item.subject.name)}</div>`
                : '';
            html += `
                <div class="reaction_item">
                    <div class="header">
                        <div class="subject_info">
                            <div class="subject_title">
                                <a href="${window.location.origin}/subject/${item.subject.id}" target="_blank">
                                    ${item.subject.nameCN || item.subject.name}
                                </a>
                            </div>
                            ${subtitle}
                            <div class="meta_info">
                                评分: ${item.rate || '无'} |
                                创建时间: ${formatTimestamp(item.created_at)} |
                                点赞数: ${item.total_reaction_users}
                            </div>
                        </div>
                    </div>
                    ${item.comment ? `<div class="comment_content">${safeComment}</div>` : ''}
                    <div class="reactions_list">
                        <div class="reaction_list_title">点赞列表</div>
                        ${reactionsHtml || '暂无点赞'}
                    </div>
                </div>
            `;
        });

        contentContainer.html(html);
    }

    // ====================== 定时任务 ======================
    // 设置每日0点定时更新
    function setupDailyUpdate() {
        // 计算距离明天0点的时间
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        const timeToMidnight = tomorrow - now;

        console.log(`将在 ${Math.round(timeToMidnight / 3600000)} 小时后自动更新数据`);

        // 设置定时器
        setTimeout(() => {
            // 每天0点执行更新
            updateReactionsData();

            // 更新后设置下一天的定时器
            setupDailyUpdate();
        }, timeToMidnight);
    }

    // ====================== 初始化 ======================
    function init() {
        // 检查GM_xmlhttpRequest是否可用
        if (typeof gmRequest === 'undefined') {
            console.error("当前环境不支持GM_xmlhttpRequest，请使用Tampermonkey/Greasemonkey等油猴插件运行此脚本");
            return;
        }

        // 初始化本地存储
        initLocalStorage();

        // 添加点赞统计标签
        addReactionTab();

        // 设置每日定时更新
        setupDailyUpdate();

        // 页面加载时如果有本地数据超过24小时，自动更新
        const localData = getFromLocalStorage();
        if (localData) {
            const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
            if (localData.last_update < oneDayAgo) {
                console.log("本地数据已超过24小时，自动更新...");
                updateReactionsData();
            }
        }
    }

    // 页面加载完成后初始化
    $(document).ready(function() {
        init();
    });

})();