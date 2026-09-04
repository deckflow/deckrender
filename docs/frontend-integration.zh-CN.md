# DeckRender Browser SDK 前端接入指南

本文面向 Web 前端。SDK 在浏览器中接收文件，转换任务在 DeckFlow 云端执行，结果以 URL/Blob 返回；不会在前端写本地文件，也不需要 Node.js polyfill。

## 1. 接入前确认

- 运行环境：现代浏览器，页面必须使用 HTTPS 或 `localhost`。
- SDK 入口：`@deckflow/deckrender/browser`，不要从包根路径导入。
- 鉴权：传 DeckFlow **用户 token**，推荐使用 `getToken`；禁止把长期应用 API Key 写进前端。
- 网络：业务域名必须通过 API、上传存储和结果存储的 CORS 校验，详见本文末尾。
- 当前没有取消任务 API。`dispose()` 只释放预览资源，不会取消已经提交的云端任务。

## 2. 安装

```bash
npm install --omit=optional @deckflow/deckrender@^0.3.0
```

`--omit=optional` 可以避免前端项目安装本地渲染所需的原生依赖。

## 3. 初始化 Renderer

建议整个前端应用复用一个 renderer。`getToken` 会在每次云端渲染前执行，便于业务层刷新用户 token。

```ts
// src/services/deckRenderer.ts
import {
  createRenderer,
  isDeckRenderError,
  type BrowserRenderResult,
  type BrowserProgressEvent,
  type ImageFormat,
  type TargetFormat,
} from '@deckflow/deckrender/browser';

const apiBase = import.meta.env.VITE_DECKFLOW_API_BASE?.trim();

export const deckRenderer = createRenderer({
  ...(apiBase ? { apiBase } : {}),
  getToken: async () => {
    // 替换为项目自己的登录态/token 刷新逻辑。
    return authStore.getDeckFlowUserToken();
  },
  onWarning: (message) => console.warn('[DeckRender]', message),
});

export interface RenderDocumentOptions {
  file: File;
  format: TargetFormat;
  imageFormat?: ImageFormat;
  pages?: string;
  width?: number;
  onProgress?: (event: BrowserProgressEvent) => void;
}

export function renderDocument(options: RenderDocumentOptions): Promise<BrowserRenderResult> {
  const { file, format, imageFormat, pages, width, onProgress } = options;

  return deckRenderer.render({
    input: file,
    format,
    ...(format === 'image' && imageFormat ? { imageFormat } : {}),
    ...(format === 'image' && pages ? { pages } : {}),
    ...(format === 'image' && width !== undefined ? { width } : {}),
    ...(onProgress ? { onProgress } : {}),
  });
}

export function describeRenderError(error: unknown): string {
  if (!isDeckRenderError(error)) {
    return error instanceof Error ? error.message : '文件转换失败';
  }

  const requestId = error.requestId ? `\nRequest ID: ${error.requestId}` : '';
  const hint = error.hint ? `\n${error.hint}` : '';
  return `${error.message}${hint}${requestId}`;
}
```

如果不使用 Vite，请把 `import.meta.env` 替换为项目自身的环境变量方案。未配置 `apiBase` 时，SDK 默认使用 `https://app.deckflow.com/v1`。

### 游客模式

仅当产品明确允许匿名上传时使用：

```ts
const guestRenderer = createRenderer({ guest: true });
```

`guest: true` 不能和 `token`、`getToken`、`spaceId` 同时使用。用户凭证失效后 SDK 不会自动降级为游客，前端应刷新登录态后由用户重试。

## 4. 最小调用示例

### 文件选择

```html
<input id="document-input" type="file" accept=".pptx,.ppt,.pdf,.key,.docx,.html,.htm,.md,.markdown" />
```

### 渲染为图片

```ts
const result = await renderDocument({
  file,
  format: 'image',
  imageFormat: 'png',
  pages: '1-3',
  width: 1920,
  onProgress: ({ phase, message }) => {
    console.log(phase, message);
  },
});

for (const output of result.outputs) {
  console.log(output.page, output.url, output.width, output.height);
}
```

### 渲染为 PDF

```ts
const result = await renderDocument({
  file,
  format: 'pdf',
});

const pdfUrl = result.outputs[0]!.url;
```

不要给 PDF 输出传 `pages`、`width`、`imageFormat`、`quality` 等图片参数。PDF 输入转 PDF 时不会上传，SDK 直接返回当前文件的本地 Blob URL。

### 渲染为视频

```ts
const result = await renderDocument({
  file,
  format: 'video',
});

const videoUrl = result.outputs[0]!.url;
```

视频当前仅支持 PPTX、PPT 和 HTML 输入，暂不支持 FPS、单页时长或转场参数。

### 常用 render 参数

| 参数          | 类型                          | 说明                                                    |
| ------------- | ----------------------------- | ------------------------------------------------------- |
| `input`       | `BrowserInput`                | 必填，文件、命名二进制或 HTML/Markdown 文本             |
| `from`        | `SourceFormat`                | 可选，文件扩展名无法识别时明确指定输入格式              |
| `format`      | `'image' \| 'pdf' \| 'video'` | 输出类型，默认 `image`                                  |
| `imageFormat` | `'png' \| 'jpg' \| 'webp'`    | 图片编码，默认 `png`，仅限图片输出                      |
| `pages`       | `string`                      | 页码或范围，仅限多页图片输出                            |
| `width`       | `number`                      | 图片长边/页面宽度，最大 32768                           |
| `scale`       | `number`                      | 图片缩放倍数，最大 16；`width` 优先                     |
| `quality`     | `'low' \| 'medium' \| 'high'` | 图片便捷预设；前端更建议显式传 `width` 和 `imageFormat` |
| `embedFonts`  | `boolean`                     | 仅用于 HTML 经 PPTX 转为 PDF/视频的路径                 |
| `timeout`     | `number`                      | 单个云端任务等待超时，单位秒，默认 300                  |
| `onProgress`  | `(event) => void`             | 阶段进度回调                                            |

## 5. 输入方式

### 直接传 File（推荐）

```ts
await deckRenderer.render({ input: file, format: 'image' });
```

文件名扩展名用于识别格式，扩展名不区分大小写。

### 传 Blob、Uint8Array 或 ArrayBuffer

二进制数据必须同时提供文件名：

```ts
await deckRenderer.render({
  input: { data: blob, name: 'deck.pptx' },
  format: 'image',
});

await deckRenderer.render({
  input: { data: bytes, name: 'document.bin' },
  from: 'pdf',
  format: 'image',
});
```

`name` 只能是文件名，不能是路径或 URL。扩展名无法识别时，可以用 `from` 明确指定原始格式。

### 传 HTML 或 Markdown 文本

```ts
await deckRenderer.render({
  input: {
    html: '<html><body><h1>Hello</h1><img src="./cover.png"></body></html>',
    baseUrl: 'https://static.example.com/deck/',
  },
  format: 'image',
});

await deckRenderer.render({
  input: { markdown: '# Hello' },
  format: 'image',
});
```

`baseUrl` 用于解析 HTML 内的相对资源，但不会复制登录态或自动上传这些资源。相关图片、CSS、字体仍需允许云端渲染环境访问。
如果直接传 HTML 文件，无法同时指定 `baseUrl`；包含相对资源时，建议读取成文本并使用 `{ html, baseUrl }`。

### 渲染已有 URL 文件

Browser SDK 不接受 URL 字符串。应由业务前端按自己的鉴权和 CORS 规则先下载，再传带文件名的 Blob：

```ts
const response = await fetch(documentUrl, {
  headers: { Authorization: `Bearer ${businessToken}` },
});
if (!response.ok) throw new Error(`下载源文件失败：${response.status}`);

const blob = await response.blob();
const result = await deckRenderer.render({
  input: { data: blob, name: 'deck.pptx' },
  format: 'image',
});
```

不要用携带私有 Cookie 的通用 URL 代理去抓取任意外部地址。

## 6. 支持格式矩阵

下表是 Browser SDK 的云端能力。`暂不支持` 会返回 `not_implemented`；`不支持` 会返回 `unsupported_format`。

| 输入格式              | 图片     | PDF      | 视频     | 备注                                  |
| --------------------- | -------- | -------- | -------- | ------------------------------------- |
| `.pptx`               | 支持     | 支持     | 支持     | 图片可选 PNG/JPG/WebP                 |
| `.ppt`                | 支持     | 暂不支持 | 支持     | 老版 PowerPoint                       |
| `.pdf`                | 支持     | 支持     | 暂不支持 | PDF → PDF 为本地透传                  |
| `.key`                | 支持     | 支持     | 暂不支持 | 图片只支持 PNG/WebP                   |
| `.docx`               | 支持     | 支持     | 不支持   | 图片路径为 DOCX → PDF → 图片          |
| `.html` / `.htm`      | 支持     | 支持     | 支持     | PDF/视频会先重建为 PPTX，布局可能变化 |
| `.md` / `.markdown`   | 支持     | 不支持   | 不支持   | 输出一张长图                          |
| `.doc`                | 不支持   | 不支持   | 不支持   | 请先转为 DOCX 或 PDF                  |
| `.xlsx`               | 暂不支持 | 暂不支持 | 不支持   | 当前没有云端表格转换器                |
| `.pages` / `.numbers` | 暂不支持 | 暂不支持 | 不支持   | 请先导出为 PDF/PPTX/DOCX              |

图片输出规则：

- `imageFormat` 可选 `png`、`jpg`、`webp`，默认 `png`。
- PPTX、PPT、PDF、DOCX 支持 PNG/JPG/WebP。
- Keynote、HTML、Markdown 支持 PNG/WebP，不支持 JPG。
- `pages` 使用 1 开始的页码，例如 `1`、`1-3`、`1,3,5-7`；只适用于多页图片输出。
- HTML 和 Markdown 固定输出一张长图，不能传 `pages`。
- PPTX/PPT 的 `width` 会吸附到最接近的 1080、1920 或 2560；PDF/DOCX 可传任意合法宽度；Keynote 不支持宽度设置。
- `width` 和 `scale` 二选一即可；同时传入时 `width` 优先。
- PDF 和视频输出不要传图片选项。
- WebP 需要额外的逐页转换步骤，长文档会比 PNG 更慢。

建议前端根据输入扩展名限制目标选项：

```ts
import type { TargetFormat } from '@deckflow/deckrender/browser';

const targetsByExtension: Record<string, readonly TargetFormat[]> = {
  pptx: ['image', 'pdf', 'video'],
  ppt: ['image', 'video'],
  pdf: ['image', 'pdf'],
  key: ['image', 'pdf'],
  docx: ['image', 'pdf'],
  html: ['image', 'pdf', 'video'],
  htm: ['image', 'pdf', 'video'],
  md: ['image'],
  markdown: ['image'],
};
```

## 7. 结果预览和下载

`render()` 成功后返回：

```ts
interface BrowserRenderResult {
  ok: true;
  input: string;
  format: 'image' | 'pdf' | 'video';
  engine: 'cloud' | 'passthrough';
  route: string[];
  pages: number; // 选择 pages 前的文档总页数
  outputs: BrowserRenderOutput[];
  durationMs: number;
  caveat?: string;
  dispose(): void;
}
```

每个 `output` 包含 `page`、`url`、`ext`、`mimeType`，以及可选的 `width`、`height`、`bytes`。图片通常有多个 output，PDF/视频通常只有一个。

### 直接预览

```ts
imageElement.src = imageOutput.url;
iframeElement.src = pdfOutput.url;
videoElement.src = videoOutput.url;
```

云端 URL 可能过期，不要把它当永久地址存入业务数据库。需要长期保存时，应下载 Blob 后上传到业务自己的对象存储。
如果结果存储禁止 iframe 嵌入，应调用 `output.blob()` 创建业务侧 Blob URL 后预览，并在结束时自行撤销该 URL。

### 下载某个结果

```ts
async function downloadOutput(
  output: BrowserRenderResult['outputs'][number],
  filename: string
): Promise<void> {
  const blob = await output.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

await downloadOutput(result.outputs[0]!, `result${result.outputs[0]!.ext}`);
```

`output.blob()` 每次都会重新下载该结果，并且不会把 API token 发给结果存储域名。

### 释放结果

组件卸载、切换文件或替换结果时调用：

```ts
previousResult?.dispose();
```

该方法可重复调用。它会撤销 SDK 创建的本地 Blob URL；不会删除云端结果，也不会取消任务。

## 8. 进度状态

```ts
const progressLabel: Record<string, string> = {
  resolve: '读取文件',
  plan: '准备转换',
  upload: '上传文件',
  task: '创建任务',
  wait: '云端转换中',
  download: '处理中间结果',
};

await deckRenderer.render({
  input: file,
  format: 'image',
  onProgress: (event) => {
    statusText.value = progressLabel[event.phase] ?? event.message;
  },
});
```

进度事件表示阶段，不是可靠的整体百分比。`ratio` 即使存在，也只表示当前阶段进度。`timeout` 是每个云端任务的等待超时，单位秒，默认 300；不是整个上传和转换流程的总超时。

## 9. 错误处理

```ts
import { isDeckRenderError } from '@deckflow/deckrender/browser';

try {
  const result = await renderDocument({ file, format: 'image' });
  showResult(result);
} catch (error) {
  if (!isDeckRenderError(error)) {
    showError('文件转换失败');
    throw error;
  }

  switch (error.code) {
    case 'auth_error':
      showLoginOrBillingPrompt(error.message);
      break;
    case 'unsupported_format':
    case 'unsupported_option':
    case 'not_implemented':
    case 'usage_error':
      showError(error.message);
      break;
    case 'render_error':
    case 'conversion_error':
      showRetry(error.message, error.requestId);
      break;
  }
}
```

| 错误码               | 含义                              | 前端建议                                 |
| -------------------- | --------------------------------- | ---------------------------------------- |
| `usage_error`        | 输入或参数非法                    | 检查文件名、空文件、页码和参数类型       |
| `auth_error`         | 缺少/失效 token，或工作区余额问题 | 刷新登录态；若为付费问题，引导充值后重试 |
| `unsupported_format` | 输入与输出组合不支持              | 根据格式矩阵禁用该选项                   |
| `unsupported_option` | 当前转换链不支持该参数            | 去掉不适用的图片、页码等参数             |
| `not_implemented`    | 已识别，但云端转换能力尚未上线    | 展示“暂不支持”，建议先转换格式           |
| `render_error`       | 任务或返回结构异常                | 保留 `requestId`，提示重试并上报         |
| `conversion_error`   | 上传、下载或转换失败              | 检查网络/CORS；保留 `requestId` 并上报   |

不要在收到 401/403/402 后自动用游客身份重新上传同一份文件。

## 10. CORS、CSP 和上线检查

生产环境至少验证以下链路：

1. API 允许前端 Origin，并允许 `X-Auth-Token`、`X-Auth-UUID`、`Content-Type`、`response-event-stream` 请求头。
2. 签名上传地址允许需要的 PUT/POST 请求和签名头；分片 OSS 上传必须通过 `Access-Control-Expose-Headers` 暴露 `ETag`。
3. 中间结果和最终结果存储允许浏览器 GET。图片能在 `<img>` 展示，不代表 `output.blob()` 或 Canvas 一定能通过 CORS。
4. CSP 的 `connect-src` 允许 API、上传和下载域名；`img-src` / `media-src` 允许结果域名以及用于 PDF 透传的 `blob:`。
5. 不要在日志、埋点、错误上报或 URL 参数中记录用户 token。

## 11. 前端验收清单

- PPTX 分别转换为 PNG、PDF、MP4。
- PDF 转 PNG，并验证 `pages: '1-3'`；PDF 转 PDF 验证不发起上传。
- DOCX 转 PDF 和图片，确认中间结果域名 CORS 正常。
- Keynote 转图片和 PDF。
- HTML/Markdown 文本以及对应文件输入均可渲染。
- JPG/WebP 的可用范围与格式矩阵一致。
- Token 正常、过期、缺失和余额不足时 UI 提示正确，且不会自动降级游客。
- 多页结果可逐页预览、单页下载；切换文件和组件卸载时调用 `dispose()`。
- 大文件、网络断开、结果 URL 过期和 CORS 失败时有可恢复提示。

更底层的浏览器约束与构建说明见 [Browser SDK](browser.md)，完整云端能力说明见 [Formats](formats.md)。
