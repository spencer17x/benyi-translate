# 本译项目协作指南

本文件适用于整个仓库。保持内容精简；当出现重复失误或稳定的新约定时再更新。若子目录存在更具体的 `AGENTS.md`，以最近者为准，但不得削弱本文的安全、密钥与验证底线。

## 项目定位

- 本译是 Chrome Manifest V3 桌面扩展，最低目标版本为 Chrome 138。
- 核心翻译使用 Chrome 本地 `Translator` / `LanguageDetector` 能力，网页正文、选中文本和译文不得发送到远程翻译服务。
- 当前正式支持范围是英语到简体中文；不要仅因协议已参数化就假定其他语言对可用。
- 用户可见文案和项目文档以中文为主；代码标识符、稳定错误码和提交信息使用英文。

## 开始工作前

1. 完整阅读用户请求与相关源码/文档。
2. 检查 `git status --short`，保留无关或用户已有改动。
3. 按顺序阅读权威来源：
   - 产品范围与使用方式：`README.md`、`docs/PRODUCT_REQUIREMENTS.md`
   - 架构与生命周期：`docs/TECHNICAL_DESIGN.md`
   - 当前阶段与已知缺口：`docs/ROADMAP.md`
   - 开发、提交和发布规则：`CONTRIBUTING.md`
   - 涉及权限、存储、日志或网络时，必须先阅读 `PRIVACY.md` 和 `SECURITY.md`
4. 选择能完整解决问题的最小改动。
5. **除非用户明确要求，否则不要** commit、push、tag、改历史、发布或部署。

## 仓库地图

- `src/background/`：扩展事件、按需注入和命令路由
- `src/content/`：页面任务核心
- `src/sidepanel/`：可选控制与状态界面
- `src/translation/`：与 DOM/消息无关的翻译执行逻辑
- `src/shared/`：协议、校验和纯工具
- `docs/`：产品与技术设计
- `dist/`、`release/`：生成物（勿手改）

## 架构与领域不变量

- `src/background/` 不要把翻译模型或依赖长期内存的任务状态放进 Service Worker。
- `src/content/` 负责发现、任务生命周期、动态页面、队列、缓存和安全渲染。继续扩展时优先拆成可测试模块，避免扩大 `content-script.ts` 的职责。
- `src/sidepanel/` 关闭面板不得暂停或销毁页面翻译任务。
- 每个任务继续使用 `tabId + pageId + taskId` 隔离，写回译文前必须校验任务身份、段落 ID、内容哈希和节点连接状态。
- 页面导航、暂停、取消和扩展重载必须中止相关工作，并阻止迟到结果写回。

## 安全与隐私

- 保留原始 DOM；译文必须通过 `textContent` 或文本节点写入，所有扩展修改必须可撤销。
- 网页内容和跨组件消息一律视为不可信输入；保留协议版本、字段长度、批量上限和来源校验。
- 不记录完整正文、选中文本、译文、页面快照或隐私 URL。
- 不引入远程推理、遥测、远程可执行代码、持久化译文或新增强制权限，除非需求明确授权，并同步更新隐私、安全和权限文档。
- `chrome.storage.local` 当前只保存非敏感界面偏好；不要静默扩大存储用途。

## 编码约定

- 语言包：typescript-node（pnpm）。
- TypeScript 保持严格类型。优先小型纯函数、可判别联合和显式生命周期，避免无理由的 `any`、非空断言和吞错。

## 运行时与环境

- Node.js `>=24.18.0 <25`、`.nvmrc` `24.18.0`、`pnpm@11.17.0`；使用仓库锁文件，不要改用 npm 或 yarn。

## 命令与验证

- 修改动态内容、导航、取消、缓存或消息协议时必须添加对应回归测试。
- 先运行与变更相关的测试；交付前运行完整检查：

  ```bash
  pnpm run check
  ```

- `pnpm run check` 包含格式检查、类型检查、全部单测和扩展构建。发布产物才使用 `pnpm run package`。
- `dist/` 和 `release/` 是生成目录，不要手工编辑或提交。
- 行为、权限、数据边界或架构发生变化时，同步更新对应 README、技术设计、需求或隐私文档。

## Git 与提交

- 除非用户明确要求，不要创建提交、推送、开 PR、修改标签或重写历史。
- 提交信息必须符合 Conventional Commits，例如 `fix(content): resume translation for dynamic nodes`。
- **核心 type：** `build`、`chore`、`ci`、`docs`、`feat`、`fix`、`perf`、`refactor`、`revert`、`test`。
- **本仓额外 type：** `style`（commitlint conventional 已允许；仅用于纯格式变更时可选；也可使用 `chore`）。
- 标题不超过 100 字符，scope 使用 kebab-case。
- `pnpm install` 不自动安装 Git hooks；需要本地快速反馈时可显式运行 `pnpm hooks:install`。
- 无论是否启用 hooks，`pnpm run check` 和远端 CI 都是权威门禁，不得以 hooks 通过替代完整检查。
- 提交前确认暂存范围只包含本任务，并保留用户已有或无关的工作区改动。

## 完成定义

- [ ] 行为完成且不破坏架构/隐私不变量
- [ ] `pnpm run check` 通过或已披露跳过原因
- [ ] 边界变更已同步文档
- [ ] 交接列出文件、验证与风险
