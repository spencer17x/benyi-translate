# 本译技术设计

## 1. 设计目标

技术方案需要同时满足：

- Chrome Manifest V3 扩展规范。
- 核心翻译完全在浏览器和用户设备内执行。
- 支持普通网页、动态页面和长页面的渐进式双语翻译。
- 不破坏原始 DOM，所有扩展产生的修改都可撤销。
- 翻译任务可观察、可取消、可重试并受资源限制。

## 2. 总体架构

```text
┌───────────────────────────────────────────────────────┐
│ Chrome Extension                                     │
│                                                       │
│  Service Worker                                      │
│  命令、右键菜单、生命周期、消息路由                   │
│          │                                            │
│          ├──────────────┐                             │
│          ▼              ▼                             │
│  Side Panel        Content Script                     │
│  控制与模型状态     文本发现、双语渲染、划词浮层      │
│          │              ▲                             │
│          ▼              │                             │
│  Translation Engine ────┘                             │
│  语言检测、可用性、队列、分块、缓存                   │
│          │                                            │
│          ▼                                            │
│  Chrome Local Language APIs                           │
└───────────────────────────────────────────────────────┘
```

### 2.1 Service Worker

职责：

- 注册扩展按钮、安装事件、快捷键和划词翻译右键菜单。
- 保存轻量全局状态并路由消息。
- 根据用户操作向当前标签页注入或唤醒 Content Script。
- 打开 Side Panel 或设置页。

边界：

- 不执行语言检测或翻译推理。
- 不持有必须长期存活的翻译会话。
- 不依赖内存状态完成任务；Service Worker 被回收后必须可恢复。

### 2.2 Content Script

职责：

- 扫描和维护当前页面的可翻译单元。
- 使用视口信息计算任务优先级。
- 监听动态 DOM 变化和单页应用导航。
- 将翻译结果安全插入原文附近。
- 管理显示模式、撤销和页面内状态。
- 在用户划词后展示隔离浮层，并执行可取消的短文本本地翻译。

Content Script 不信任网页脚本，不通过页面全局变量交换敏感数据。

### 2.3 Side Panel

职责：

- 提供页面翻译控制、目标语言、状态、进度和错误信息。
- 在用户手势上下文中触发首次语言资源准备。
- 作为首版的翻译执行宿主，避免 Popup 关闭导致长任务中断。
- 显示不包含正文的诊断指标。

生命周期约定：

- 每个标签页最多存在一个页面翻译任务，使用 `tabId + pageId + taskId` 唯一标识。
- 切换标签页不取消原任务；Side Panel 默认显示当前活动标签页的状态。
- 用户关闭 Side Panel 后，未完成任务进入暂停状态，页面保留已完成译文；重新打开后可继续。
- 全部标签页共享一个翻译调度器，首版全局推理并发数为 1。

如果后续验证其他文档上下文可提供更稳定的长期执行环境，可以替换宿主实现，但不得改变消息协议和隐私边界。

### 2.4 Translation Engine

职责：

- API 特性检测和语言对可用性检查。
- 语言资源下载状态管理。
- 语言检测实例和翻译实例复用。
- 按语言对组织顺序队列。
- 文本规范化、去重、分块和取消。
- 内存缓存与受限持久化缓存。

能力状态必须映射为“可用、需准备、准备中、不可用”。由于浏览器可能在首次创建前隐藏具体语言包的下载状态，界面不得把“需准备”进一步解释为确定的“尚未下载”。首次创建和资源准备必须保留明确的用户操作上下文。

## 3. 消息协议

所有消息使用带版本和任务身份的可判别联合类型：

```ts
type TaskIdentity = {
  tabId: number;
  pageId: string;
  taskId: string;
};

type PanelToPageMessage =
  | { version: 1; type: "PANEL_HELLO"; tabId: number }
  | ({ version: 1; type: "PAGE_COLLECT" } & TaskIdentity)
  | ({ version: 1; type: "TRANSLATION_RESULT"; batchId: string; results: SegmentResult[] } & TaskIdentity)
  | ({ version: 1; type: "TRANSLATION_PAUSE" | "TRANSLATION_RESUME" | "TRANSLATION_CANCEL" } & TaskIdentity)
  | ({ version: 1; type: "TASK_COMPLETE" | "PAGE_UNDO" } & TaskIdentity)
  | ({ version: 1; type: "TASK_FAIL"; errorCode: string } & TaskIdentity)
  | ({ version: 1; type: "PAGE_MODE_SET"; mode: DisplayMode } & TaskIdentity);

type PageToPanelMessage =
  | { version: 1; type: "PAGE_STATE"; status: TaskStatus; progress: TaskProgress }
  | ({ version: 1; type: "PAGE_COLLECTION"; sourceSample: string; total: number } & TaskIdentity)
  | ({ version: 1; type: "PAGE_SEGMENTS"; batchId: string; segments: SegmentInput[]; done: boolean } & TaskIdentity)
  | ({ version: 1; type: "TASK_PROGRESS"; progress: TaskProgress } & TaskIdentity)
  | ({ version: 1; type: "TASK_ERROR"; errorCode: string } & TaskIdentity);
```

基本数据结构：

```ts
type SegmentInput = {
  segmentId: string;
  sourceText: string;
  contentHash: string;
  sourceLanguage: string;
  targetLanguage: string;
  priority: number;
};

type SegmentResult = {
  segmentId: string;
  contentHash: string;
  status: "translated" | "failed" | "cancelled";
  translatedText?: string;
  errorCode?: string;
};

type TaskProgress = {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
};
```

当前实现以 `src/shared/protocol.ts` 为协议定义源，文档只保留消息族和关键字段概览。

协议要求：

- 每个页面生命周期使用随机 `pageId`，导航后旧结果自动失效。
- 每次开始生成新的 `taskId`，暂停和继续保持原 `taskId`，取消后重新开始必须生成新 `taskId`；每个批次使用唯一 `batchId`，迟到批次不得写回新任务。
- 每个段落使用稳定 `segmentId`，结果不得依赖数组下标回写。
- 接收方必须校验消息版本、类型、字段长度、批次数量和来源标签页；消息中的 `tabId` 必须与可信的发送方上下文一致。
- 批次必须设置最大段落数和最大正文字符数，超过上限的消息直接拒绝。
- 正文不写入日志，不在错误消息中原样回显。

## 4. 文本发现与分段

### 4.1 默认排除规则

默认排除以下元素及其后代：

```text
script, style, noscript, textarea, input, select, option,
[contenteditable="true"], [data-benyi-root]
```

首版默认跳过 `pre`、`code`、SVG 和 Canvas；用户可在后续版本中为代码块单独开启翻译。

站点适配器可以在不扩大通用选择器的前提下补充经过验证的正文容器。当前 X/Twitter 适配器识别 `[data-testid="tweetText"]`，并优先使用正文节点的 `lang`，避免中文界面语言覆盖英文帖子语言。

### 4.2 可见性

- 使用布局信息和 `IntersectionObserver` 判断视口及临近区域。
- 跳过 `display: none`、`visibility: hidden` 和无布局盒的内容。
- 不为屏外全部节点同步计算昂贵样式；扫描和测量分批执行。

### 4.3 分段策略

1. 首版从标题、段落、列表项和引用中建立语义翻译单元。
2. 合并同一语义块内相邻的短文本节点。
3. 保留节点映射和内联边界，不直接拼接后覆盖原 DOM。
4. 对超配额段落优先按句号、问号、换行等边界分块。
5. 无安全边界时按测量结果继续切分，并在展示阶段按顺序合并。

### 4.4 节点状态

使用 `WeakMap<Node, SegmentState>` 保存运行时映射，并为扩展插入节点添加受控的 `data-benyi-*` 标识。不得在页面原始节点上存放正文副本。

## 5. 翻译流水线

```text
发现文本
→ 规范化与过滤
→ 页面内去重
→ 页面级语言检测
→ 语言对可用性检查
→ 输入配额测量与分块
→ 按语言对排队
→ 本地翻译
→ 安全渲染
→ 更新缓存与指标
```

### 5.1 规范化

- 合并用于缓存键的多余空白。
- 保留展示原文，不修改网页文本。
- 页面源语言默认从可见正文聚合样本检测，并以 `html[lang]` 作为低置信度回退；短文本继承页面语言，文本单元级重新检测属于 P1。
- 缓存键使用稳定哈希，不以原文作为存储键。
- 页面内存缓存键至少包含源语言、目标语言、文本哈希和缓存结构版本。
- 首版不依赖浏览器未公开的翻译模型版本标识。

### 5.2 队列

- 每个语言对维护逻辑队列，但所有队列由同一个全局调度器执行。
- 当前视口任务使用最高优先级，临近视口次之，屏外任务最低。
- 首版全局推理并发数固定为 1；在验证 API 和设备资源安全前不增加并发。
- 每个页面维护 `AbortController`，取消或导航时统一中止。
- 结果写入前再次校验 `tabId`、`pageId`、`taskId` 和段落当前内容哈希。

### 5.3 实例生命周期

- 语言检测实例在翻译宿主生命周期内复用。
- 整页翻译实例在 Side Panel 生命周期内复用；划词翻译实例在当前页面生命周期内复用。
- 长时间空闲、内存压力或宿主关闭时主动销毁实例；宿主关闭产生的任务状态由 Content Script 保留为“已暂停”。
- 如果语言资源状态发生变化，清理旧实例并重新检查可用性。

### 5.4 错误分类

对外只暴露稳定错误码：

```text
API_UNSUPPORTED
PAIR_UNAVAILABLE
MODEL_DOWNLOAD_REQUIRED
MODEL_DOWNLOAD_FAILED
INPUT_TOO_LARGE
TRANSLATION_CANCELLED
TRANSLATION_TIMEOUT
PAGE_NAVIGATED
UNKNOWN_ERROR
```

用户界面使用可理解的说明；底层异常栈仅在开发模式显示，并必须去除正文。

## 6. 双语渲染

### 6.1 安全写入

- 译文使用 `textContent` 或新建文本节点写入。
- 不把译文解析为 HTML。
- 不复制原节点事件处理器。
- 所有样式放在扩展样式表或受控 Shadow DOM 中。

### 6.2 展示模型

首版只对标题、段落、列表项和引用建立伴随译文。伴随节点必须根据宿主语义和布局选择合法结构，不得对所有页面统一插入块级 `div`。普通段落的示意结构如下：

```html
<p>Original paragraph.</p>
<div class="benyi-translation" data-benyi-segment="...">译文段落。</div>
```

仅译文模式通过可逆 CSS 状态隐藏原文，不删除原节点。撤销时移除扩展节点和扩展设置的类名。

对于表格、导航、按钮、代码块以及可能被 Flex/Grid 结构破坏的容器，首版默认跳过；公开测试版本必须提供按容器类型验证过的渲染策略后才能启用。

### 6.3 动态页面

- `MutationObserver` 只记录候选根节点，使用短时间窗口合并处理。
- 忽略扩展自身插入节点产生的变化。
- 节点文本变化后更新内容哈希，旧结果失效并重新排队。
- History API 和浏览器导航事件触发新的页面生命周期。
- M0 必须在 `webNavigation`、受控主世界桥接或内容生命周期判定中选定 SPA 导航方案，并同步最终权限清单；未验证前不得静默扩大站点权限。

## 7. 缓存设计

两级缓存：

1. **页面内存缓存**：当前页面去重和即时复用，页面关闭后释放。
2. **浏览器本地缓存（P1）**：默认关闭，用户明确启用后才写入译文；可清除、有容量上限，使用 LRU 淘汰。

缓存记录不包含页面 URL、DOM 路径或整页快照。建议结构：

```ts
type CacheEntry = {
  key: string;
  translatedText: string;
  createdAt: number;
  lastUsedAt: number;
  cacheSchemaVersion: number;
  chromeMajorVersion: number;
};
```

页面内存缓存容量上限应通过配置常量控制，并在真实文本数据测试后确定默认值。持久化缓存进入 P1 前必须补充容量、失效和隐私界面验收。

## 8. 权限策略

首版遵循最小权限：

- `activeTab`：用户明确触发后处理当前页面。
- `scripting`：按需注入 Content Script。
- `contextMenus`：提供“使用本译翻译选中文本”的右键入口。
- `sidePanel`：提供持续的控制与状态界面。

`storage` 当前仅使用 `storage.session` 暂存快捷键命令，不保存网页正文或译文；站点规则或受限持久化缓存实际实现后再扩展本地存储用途。

自动翻译站点需要持久站点访问权限时，使用可选权限按需申请。不得为了简化实现而默认申请与功能无关的权限。

## 9. 隐私与安全边界

- 核心翻译不向远程服务发送正文。
- 扩展不采集浏览历史和页面快照。
- 所有网页输入视为不可信数据。
- 不执行远程代码，不使用运行时下载脚本。
- 不向网页暴露翻译引擎对象、扩展内部状态或缓存。
- 调试导出仅包含版本、能力状态、计数、耗时和错误码。

## 10. 测试策略

### 10.1 单元测试

- 文本过滤和语义分段。
- 文本规范化与缓存键。
- 优先队列、取消和迟到结果丢弃。
- 消息校验。
- 安全渲染与撤销。

### 10.2 集成测试

- 静态文章、列表、表格和混合语言页面。
- 单页应用路由和无限滚动。
- 首次下载、不可用、失败、重试和资源被回收。
- 页面刷新、标签关闭和扩展重新加载。
- Side Panel 关闭、重新打开、标签切换和多标签页任务身份校验。

### 10.3 端到端测试

- 使用真实受支持 Chrome 验证本地语言能力。
- 检查翻译过程中的网络请求，确认正文未发往远程推理服务。
- 验证键盘、屏幕阅读器标签和焦点管理。
- 在 Windows、macOS 和 Linux 上完成发布前手动矩阵测试。
- 使用固定长文夹具记录首个可见段落延迟 P50/P95、内存峰值和 50 毫秒以上长任务数量，并在 M0 冻结发布阈值。

## 11. 已知边界

- 浏览器内部页面和 Chrome Web Store 等受保护页面无法注入脚本。
- 封闭 Shadow DOM 无法可靠读取。
- 跨域 iframe 取决于扩展权限和注入条件。
- Canvas、图片和扫描 PDF 没有可直接翻译的 DOM 文本。
- 页面复杂样式可能影响伴随译文排版，需要站点兼容规则逐步完善。
