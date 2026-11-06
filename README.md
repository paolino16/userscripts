# 私有油猴脚本合集

集中保存个人使用的 Tampermonkey 脚本与修改历史。目前收录一个脚本，其余待从 Tampermonkey 导出后加入。

## bgm_reactions_statistics 4.4.0

位置：`scripts/bgm-reactions-statistics/bgm-reactions-statistics.user.js`。
保留原作者徒手开根号二、namespace sqrtwo 与原 MIT 声明。

在 bgm.tv、bangumi.tv、chii.in 的时间线页面显示当前登录用户收到的短评点赞，沿用按条目保留最新记录的原有统计口径。缓存按用户、站点分别存储，不跨域同步。

### 安装与更新

登录 GitHub 后打开脚本文件，复制完整内容到 Tampermonkey 对应脚本编辑器并保存。私有仓库用于版本跟踪，不配置带令牌的自动更新 URL。浏览器中的已安装版本尚未由本次操作替换。

### 4.4.0 修复

- 检测重复分页与无效 ID；空页立即结束，页间等待 250ms。
- 网络或响应错误不再保存残缺结果；停止更新后保留原缓存（当前在途请求可能等待至 10 秒超时）。
- 避免重复点击产生并发刷新。
- 已抓取时间线中取消的点赞会从缓存删除；确认全量完成时替换旧快照。达到页数上限时只更新抓取范围。
- 对昵称、条目名等输出转义，修复统计摘要刷新。
- fetch 兜底使用真实超时信号，损坏缓存不会被悄悄覆盖。
- 仅时间线页面安排自动更新，避免每个站点页面都触发扫描。

限制：增量更新只回填两页，较老记录的点赞变化需要全量刷新；默认安全上限 100 页。多个浏览器标签页之间尚无互斥锁；仍依赖站点 jQuery 和原有 next.bgm.tv API。API 与浏览器实站行为尚未联调。

### 验证

无需安装依赖：

```sh
node --check scripts/bgm-reactions-statistics/bgm-reactions-statistics.user.js
node --test scripts/bgm-reactions-statistics/script.test.cjs
```

六个模拟测试覆盖空页、重复分页、异常结构、末页、HTML 转义、缺失点赞用户字段。

