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
│  控制与模型状态     文本发现、任务标识、双语渲染      │
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

- 注册扩展按钮、快捷键、右键菜单和安装事件。
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

Content Script 不信任网页脚本，不通过页面全局变量交换敏感数据。

### 2.3 Side Panel

职责：

- 提供页面翻译控制、目标语言、状态、进度和错误信息。
- 在用户手势上下文中触发首次语言资源准备。
- 作为首版的翻译执行宿主，避免 Popup 关闭导致长任务中断。
- 显示不包含正文的诊断指标。

如果后续验证其他文档上下文可提供更稳定的长期执行环境，可以替换宿主实现，但不得改变消息协议和隐私边界。

### 2.4 Translation Engine

职责：

- API 特性检测和语言对可用性检查。
- 语言资源下载状态管理。
- 语言检测实例和翻译实例复用。
- 按语言对组织顺序队列。
- 文本规范化、去重、分块和取消。
- 内存缓存与受限持久化缓存。

## 3. 消息协议

所有消息使用带版本的可判别联合类型：

```ts
type Message =
  | { version: 1; type: "PAGE_COLLECT"; pageId: string }
  | { version: 1; type: "TRANSLATE_BATCH"; pageId: string; batch: SegmentInput[] }
  | { version: 1; type: "TRANSLATION_RESULT"; pageId: string; results: SegmentResult[] }
  | { version: 1; type: "TRANSLATION_CANCEL"; pageId: string }
  | { version: 1; type: "PAGE_MODE_SET"; pageId: string; mode: DisplayMode };
```

基本数据结构：

```ts
type SegmentInput = {
  segmentId: string;
  sourceText: string;
  sourceLanguage?: string;
  targetLanguage: string;
  priority: number;
};

type SegmentResult = {
  segmentId: string;
  status: "translated" | "skipped" | "failed" | "cancelled";
  translatedText?: string;
  detectedLanguage?: string;
  errorCode?: string;
};
```

协议要求：

- 每个页面生命周期使用随机 `pageId`，导航后旧结果自动失效。
- 每个段落使用稳定 `segmentId`，结果不得依赖数组下标回写。
- 接收方必须校验消息版本、类型、字段长度和来源标签页。
- 正文不写入日志，不在错误消息中原样回显。

## 4. 文本发现与分段

### 4.1 默认排除规则

默认排除以下元素及其后代：

```text
script, style, noscript, textarea, input, select, option,
[contenteditable="true"], [data-benyi-root]
```

首版默认跳过 `pre`、`code`、SVG 和 Canvas；用户可在后续版本中为代码块单独开启翻译。

### 4.2 可见性

- 使用布局信息和 `IntersectionObserver` 判断视口及临近区域。
- 跳过 `display: none`、`visibility: hidden` 和无布局盒的内容。
- 不为屏外全部节点同步计算昂贵样式；扫描和测量分批执行。

### 4.3 分段策略

1. 从文本节点向上寻找适合的语义块，如段落、列表项、标题和表格单元格。
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
→ 语言检测
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
- 缓存键使用稳定哈希，不以原文作为存储键。
- 缓存键至少包含源语言、目标语言、文本哈希和引擎版本。

### 5.2 队列

- 每个语言对维护独立队列。
- 当前视口任务使用最高优先级，临近视口次之，屏外任务最低。
- 队列默认顺序执行；在验证 API 和设备资源安全前不增加并发。
- 每个页面维护 `AbortController`，取消或导航时统一中止。
- 结果写入前再次校验 `pageId` 和段落当前内容哈希。

### 5.3 实例生命周期

- 语言检测实例在翻译宿主生命周期内复用。
- 翻译实例按 `sourceLanguage:targetLanguage` 缓存。
- 长时间空闲、内存压力或宿主关闭时主动销毁实例。
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

每个原文语义块后插入一个伴随节点：

```html
<p>Original paragraph.</p>
<div class="benyi-translation" data-benyi-segment="...">译文段落。</div>
```

仅译文模式通过可逆 CSS 状态隐藏原文，不删除原节点。撤销时移除扩展节点和扩展设置的类名。

### 6.3 动态页面

- `MutationObserver` 只记录候选根节点，使用短时间窗口合并处理。
- 忽略扩展自身插入节点产生的变化。
- 节点文本变化后更新内容哈希，旧结果失效并重新排队。
- History API 和浏览器导航事件触发新的页面生命周期。

## 7. 缓存设计

两级缓存：

1. **页面内存缓存**：当前页面去重和即时复用，页面关闭后释放。
2. **浏览器本地缓存**：可关闭、可清除、有容量上限，使用 LRU 淘汰。

缓存记录不包含页面 URL、DOM 路径或整页快照。建议结构：

```ts
type CacheEntry = {
  key: string;
  translatedText: string;
  createdAt: number;
  lastUsedAt: number;
  engineVersion: string;
};
```

首版容量上限应通过配置常量控制，并在真实文本数据测试后确定默认值。

## 8. 权限策略

首版遵循最小权限：

- `activeTab`：用户明确触发后处理当前页面。
- `scripting`：按需注入 Content Script。
- `storage`：保存设置、站点规则和受限缓存。
- `contextMenus`：提供右键翻译入口。
- `sidePanel`：提供持续的控制与状态界面。

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

### 10.3 端到端测试

- 使用真实受支持 Chrome 验证本地语言能力。
- 检查翻译过程中的网络请求，确认正文未发往远程推理服务。
- 验证键盘、屏幕阅读器标签和焦点管理。
- 在 Windows、macOS 和 Linux 上完成发布前手动矩阵测试。

## 11. 已知边界

- 浏览器内部页面和 Chrome Web Store 等受保护页面无法注入脚本。
- 封闭 Shadow DOM 无法可靠读取。
- 跨域 iframe 取决于扩展权限和注入条件。
- Canvas、图片和扫描 PDF 没有可直接翻译的 DOM 文本。
- 页面复杂样式可能影响伴随译文排版，需要站点兼容规则逐步完善。
