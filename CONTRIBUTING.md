# 贡献指南

感谢你帮助改进本译。项目当前优先完善产品需求和技术验证，欢迎提交需求反馈、兼容性信息、交互建议和实现贡献。

## 提交 Issue

提交前请先搜索现有 Issue，避免重复。Bug 报告请包含：

- Chrome 版本和操作系统。
- 页面类型和最小复现步骤。
- 期望行为与实际行为。
- 不包含网页正文的诊断信息。

请勿在公开 Issue 中粘贴私人页面内容、访问令牌或其他敏感数据。安全问题请按照 [SECURITY.md](SECURITY.md) 私下报告。

## 开发原则

- 保持本地优先和隐私优先，不引入隐式远程推理。
- 只申请完成明确功能所需的最小权限。
- 保留原始网页内容，所有修改必须可撤销。
- 将网页输入视为不可信数据，安全地写入译文。
- 优先完成 P0 需求，避免在核心流程稳定前扩张范围。

## 本地检查

本地开发使用 Node.js 24 和 pnpm 11.5 或更高版本。首次开发先安装依赖；安装过程会通过 Husky 自动启用仓库内的 Git hooks：

```bash
pnpm install
```

提交前运行：

```bash
pnpm run check
```

该命令会执行格式检查、类型检查、单元测试，并构建可加载的 `dist/` 扩展产物。也可以按需运行：

```bash
pnpm run format
pnpm run typecheck
pnpm test
pnpm run build
```

本地 hooks 与远程 CI 分工如下：

- `pre-commit`：格式化暂存的源码和配置；修改 TypeScript 时运行类型检查与单元测试。
- `commit-msg`：使用 commitlint 校验 Conventional Commits 格式。
- `pre-push`：运行完整的 `pnpm run check`。
- GitHub Actions：重新校验提交区间和空白错误，使用锁文件安装依赖，执行完整检查、构建与打包，并上传测试产物。

hooks 是快速反馈，不替代远程 CI。维护者应将 GitHub 分支规则中的 `CI / verify` 设为合并前必需检查。

## Pull Request

1. 从默认分支创建功能分支。
2. 让每个 PR 聚焦一个问题。
3. 更新相关需求、架构或用户文档。
4. 添加或更新与变更对应的测试。
5. 在 PR 中说明变更内容、原因、用户影响和验证方式。

## 提交信息

提交信息使用 Conventional Commits。版本号和 `CHANGELOG.md` 会据此自动生成：

```text
feat: add viewport-priority translation queue
fix: ignore stale results after page navigation
docs: explain optional host permissions
```

允许的类型包括 `build`、`chore`、`ci`、`docs`、`feat`、`fix`、`perf`、`refactor`、`revert`、`style` 和 `test`。标题不超过 100 个字符；可选 scope 使用小写 kebab-case，例如 `fix(side-panel): restore translation state`。

`fix:` 对应补丁版本，`feat:` 对应次版本，带 `!` 或 `BREAKING CHANGE:` 的提交对应主版本。纯文档、测试和构建改动会进入 Release PR，但默认不单独触发版本升级。

## 需求变更

涉及以下内容的变更应先通过 Issue 讨论：

- 新的远程网络请求或数据收集。
- 新的强制扩展权限。
- 改变默认隐私行为。
- 扩大首版平台或文档类型范围。
- 更换核心翻译执行方式。

## 许可证

提交贡献即表示你同意以本仓库的 MIT 许可证发布贡献内容。
