# 本译 Benyi

> 本地运行，保留本意。

本译是一款面向 Chrome 桌面端的隐私优先沉浸式翻译扩展。它使用浏览器内置的本地语言能力，在设备上完成语言识别和翻译，将译文以双语形式自然地嵌入网页。

[下载最新版本](https://github.com/spencer17x/benyi-translate/releases/latest)

项目当前处于 MVP 验证阶段，通过 GitHub Release 提供可下载测试版本。

## 产品原则

- **本地优先**：核心翻译在用户设备上完成，不依赖翻译 API Key 或远程推理服务。
- **隐私优先**：默认不上传网页内容、选中文本或翻译结果。
- **保留原文**：不破坏原页面内容，用户可以随时查看原文或撤销翻译。
- **渐进呈现**：优先翻译当前视口，边阅读边完成后续内容。
- **用户可控**：翻译语言、显示方式、站点规则和缓存都由用户决定。

## 核心能力

| 能力 | 交付范围 |
| --- | --- |
| 整页翻译 | 提取可阅读文本并按视口优先级翻译 |
| 双语排版 | 在原文下方插入译文，可切换仅原文、双语、仅译文 |
| 自动识别 | 自动检测原文语言，跳过无需翻译的内容 |
| 即时翻译 | 支持划词浮层、右键菜单和可配置快捷键触发 |
| 动态页面 | 首版处理新增文本，公开测试版本增强单页应用和无限滚动支持 |
| 本地缓存 | 首版使用页面内存缓存；持久化缓存默认关闭并在公开测试版本提供 |
| 模型状态 | 展示可用性、首次下载进度和错误恢复提示 |

## 支持范围

- Chrome 桌面版，最低目标版本为 Chrome 138。
- Windows 10/11、macOS 13+ 和主流桌面 Linux。
- 首版保证英语网页到简体中文；其他语言对在能力验证通过后逐步开放。
- 首版聚焦普通 HTML 网页；PDF、图片文字、Canvas 内容和视频字幕列入后续规划。

## 文档

- [产品需求文档](docs/PRODUCT_REQUIREMENTS.md)
- [技术设计](docs/TECHNICAL_DESIGN.md)
- [开发路线图](docs/ROADMAP.md)
- [隐私政策](PRIVACY.md)
- [隐私与安全](SECURITY.md)
- [版本更新记录](CHANGELOG.md)
- [贡献指南](CONTRIBUTING.md)

## 计划中的目录结构

```text
benyi-translate/
├── src/
│   ├── background/      # 扩展事件、命令和消息路由
│   ├── content/         # 文本提取、本地翻译与双语渲染
│   ├── sidepanel/       # 可选的翻译控制和状态界面
│   ├── translation/     # 语言检测、翻译队列和缓存
│   └── shared/          # 类型、协议和公共工具
├── tests/
├── docs/
└── manifest.json
```

## 当前状态

- [x] 产品定位与范围
- [x] 首版功能需求与验收框架
- [x] 初步技术架构
- [x] Manifest V3 工程骨架
- [x] GitHub Release 自动打包与版本记录
- [ ] 整页双语翻译 MVP
- [x] 划词翻译、右键菜单与可配置快捷键
- [ ] 公开测试：持久缓存与站点规则

## 下载与安装

1. 打开 [Releases](https://github.com/spencer17x/benyi-translate/releases/latest)，下载 `benyi-translate-v*.zip`。
2. 解压 ZIP。
3. 在 Chrome 中打开 `chrome://extensions` 并启用“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择解压后的目录。

由于本译不通过 Chrome Web Store 分发，Chrome 不允许普通用户直接安装 ZIP 或 CRX；首次安装必须完成以上开发者模式步骤。更新时下载新版 ZIP，并在扩展管理页重新加载对应目录。

## 本地开发

安装依赖并运行全部检查：

```bash
pnpm install
pnpm run check
```

`pnpm run check` 会依次执行格式检查、TypeScript 类型检查、单元测试和扩展构建，构建产物位于 `dist/`。首次安装依赖时也会自动启用项目的 Git hooks；具体规则见[贡献指南](CONTRIBUTING.md)。

生成与 GitHub Release 相同的 ZIP 和 SHA-256 文件：

```bash
pnpm run package
```

产物位于 `release/`，ZIP 中不包含源码映射。

在 Chrome 中打开 `chrome://extensions`，启用开发者模式，选择“加载已解压的扩展程序”并指向本仓库的 `dist/`。随后可以启动固定英文夹具：

```bash
pnpm run fixture
```

访问 `http://127.0.0.1:4173/`，点击本译扩展图标即可直接翻译当前页面。页面右下角会短暂显示准备状态和翻译进度，控制面板无需保持打开。

可以使用 `Ctrl+Shift+U`（macOS 为 `Command+Shift+U`）直接翻译当前页面，使用 `Ctrl+Shift+P`（macOS 为 `Command+Shift+P`）暂停或继续，使用 `Ctrl+Shift+X`（macOS 为 `Command+Shift+X`）取消翻译，或使用 `Ctrl+Shift+Y`（macOS 为 `Command+Shift+Y`）通过工具栏命令翻译当前页。撤销全部译文和切换显示方式也提供可配置命令。右键点击工具栏中的本译图标并选择“打开本译控制面板”，可以查看状态、切换显示方式、自定义译文颜色和管理快捷键；颜色偏好只保存在本机，关闭面板不会暂停翻译。

划词翻译有三种触发方式：打开过本译的当前页面会在选区旁显示“译”按钮；也可以在任意普通网页选中文本后右键选择“使用本译翻译选中文本”；还可以在快捷键管理页为“翻译选中文本”分配键位。译文卡支持复制、重新翻译和关闭。右键菜单或快捷键首次触发后，当前页面后续划词会直接显示悬浮按钮。

当前实现已打通按需注入、页面内隔离翻译、页面文本发现、X 帖子与长文章正文识别、视口优先队列、语言检测、英译中、安全渲染、划词浮层、内存缓存、显示模式、暂停、取消和撤销。复杂 SPA 导航、无限滚动持续翻译、持久化缓存和站点规则仍在后续里程碑中。

## 自动版本与发布

项目使用 Release Please 根据 Conventional Commits 维护 Release PR：

- `fix:` 生成补丁版本，例如 `0.1.0 → 0.1.1`。
- `feat:` 生成次版本，例如 `0.1.0 → 0.2.0`。
- `feat!:`、`fix!:` 或 `BREAKING CHANGE:` 生成主版本。

Release PR 会同步更新 `package.json`、扩展 Manifest 和 `CHANGELOG.md`。合并 Release PR 后，CI 会完整检查项目、生成 ZIP 和 SHA-256，上传到草稿 GitHub Release；只有全部步骤成功后才会正式发布。

## 贡献

欢迎通过 Issue 讨论需求、兼容性和交互方案。开始贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

[MIT](LICENSE)
