# Changelog

本项目所有显著变化都会记录在这里。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

发版流程：在 `[Unreleased]` 段随手累积条目；发版时把 `[Unreleased]` 改成 `[X.Y.Z] - YYYY-MM-DD`，bump 三处版本号字面量（`desktop/package.json` / `desktop/src-tauri/tauri.conf.json` / `desktop/src-tauri/Cargo.toml`），最后一个 commit 必须是 `release: vX.Y.Z`，然后 `git tag -a vX.Y.Z -m "vX.Y.Z"` 并 `git push --follow-tags`。

---

## [Unreleased]

<!-- 新条目往这里加；分组用 Added / Changed / Fixed / Removed / Deprecated / Security -->

## [3.1.5] - 2026-06-29

提交范围 `790f37cb..625d5a18`，12 个 commit。详细 release note 见 [docs/release-notes/v3.1.5.md](docs/release-notes/v3.1.5.md)。

### Fixed
- 用户主动停止流时不再弹 "Stream ended without receiving any events" 误报（`handler.ts` assistant 分支补 `sessionStopRequested` 守卫）。
- AskUserQuestion 在 CLI 重放 `tool_use_complete` 时不再出现重复弹窗 / 卡片（`chatStore` 按 `toolUseId` 幂等去重）。
- 新会话首条消息不再覆盖用户的手动重命名（`wipeSession` 保留 `custom-title` entry）。
- Skill 安装在 Windows Defender 实时扫描下不再 500（PowerShell `Expand-Archive` 改 `execFile` + 90s 上限，超时返回 504）。
- ContextUsageIndicator 在大会话下不再频繁记 `client_api_request_failed`（client 超时 20s → 24s，避开 server 端 20s tokenize 边界）。
- CLI stderr 中 `[tools:` / `[claude:` / `[print:` 前缀的调试行不再被记成 runtime error。
- bypass 模式允许 Windows 映射盘（Z:、X: 等）作为工作目录，仍拦截真正的 UNC `\\server\share`。
- Windows 下 `~` 开头的工作目录在启动 session 时自动展开，修掉 "No conversation found" 假退出。

### Changed
- 统一升级到 GLM 5.2（1M context），fallback 切到 glm-4.5-air；glm-5.1 / glm-5-turbo 上游已下线。
- `.env.example` 与中英文档示例默认 MiniMax 模型从 M2.7 升级到 M3（`providerPresets.json` 之前已是 M3）。

### Removed
- 删除桌面端 `TextQuestionModal`（启发式抽题弹窗路径不再保留）和 `ActiveSession` 中 `AskUserQuestionModal` 挂载。

### Internal
- 同步上游 cc-haha v0.3.1 → v0.4.3 中对 AmbiCrew 真正缺失的部分（batch 0/1/5/6），其余批次已独立实现或推迟。
- 测试：隔离 `AUTH_MODE` / `ANTHROPIC_DEFAULT_*_NAME` 环境变量泄露；同步 provider-presets 断言（custom preset 下线、crewcentral 追加、MiniMax M3）；跳过 Tauri 时代陈旧的 `updateStore` / `UpdateChecker` 测试。

## [3.1.4] - 2026-06-16

最初未跟踪 changelog；摘要见 commit `790f37cb`。

---

[Unreleased]: https://github.com/Carlzzz/AmbiCrew/compare/v3.1.5...HEAD
[3.1.5]: https://github.com/Carlzzz/AmbiCrew/compare/v3.1.4...v3.1.5
[3.1.4]: https://github.com/Carlzzz/AmbiCrew/releases/tag/v3.1.4
