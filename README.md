# PSD2AI

将 PSD 设计稿转换为 AI 可读的结构化数据，包含精确的布局信息和优化的缩略图。

## 为什么需要这个工具？

当你想让 AI（如 Claude、GPT）理解你的设计稿时：
- ❌ 截图 → AI 无法获取精确的位置、尺寸信息
- ✅ PSD2AI → 导出结构化 JSON + 缩略图 → AI 完全理解布局

## 特性

- 📐 **精确布局数据** - 提取每个图层的位置、尺寸、边界
- 🖼️ **图层导出** - 自动导出所有图层为独立 PNG 图片
- 🔍 **智能缩略图** - 生成适合 AI 读取的压缩版本，节省 token
- 📝 **文本提取** - 提取文本内容、字号、颜色
- 📄 **AI Prompt 模板** - 自动生成使用说明和 prompt 模板
- 🎯 **零配置** - 开箱即用，一条命令完成转换

## 安装

### 全局安装

```bash
npm install -g psd2ai
```

### 使用 npx（无需安装）

```bash
npx psd2ai your-design.psd
```

## 使用

### 基础用法

```bash
# 转换 PSD 文件到 output 目录
psd2ai design.psd

# 指定输出目录
psd2ai design.psd my-output

# 使用 npx
npx psd2ai design.psd
```

### 输出结构

```
output/
├── README.md              # AI 使用说明和图层详情
├── layout.json            # 结构化布局数据
├── preview.png            # 完整预览图
├── layer_sources/         # 原始图层图片
│   └── layer_*.png
└── thumb/                 # 缩略图目录（适合 AI 读取）
    ├── preview.png
    └── layer_*.png
```

### layout.json 示例

每个导出的组和图层都有文档内唯一的 `id`。PSD 内有可用的原生图层 ID 时，使用 `psd_<原生 ID>`。原生 ID 缺失或重复时，使用 `layer_<源图层树中的索引路径>`。索引路径随图层顺序和分组变化。用 `id` 引用节点，用 `image` 和 `thumbnail` 定位图片。

文字图层导出独立透明 PNG 时会合成已启用的纯色外描边、内描边、居中描边、投影、外发光和正常模式的颜色叠加。导出坐标和尺寸对应合成后的可见像素，文字内容仍保存在 `text` 中。存在已启用样式时，`text.simpleStyle` 为 `false`，下游可使用该 PNG 保留文字外观。

投影使用样式中保存的角度、距离、扩展、大小和不透明度。投影与外发光的羽化使用高斯近似，依赖背景的混合模式按普通透明合成近似。渐变或图案填充、斜面浮雕、内阴影和内发光等样式会记录到导出日志。

组的单个正常模式纯色外描边也可导出。所有可见子图层的扩边矩形互不相交，且组内使用默认混合、全不透明度、无蒙版和剪贴时，描边会合成到每个文字或图片切图。存在子图层自身样式或组混合限制时，日志会说明原因并按原图层导出。

```json
{
  "name": "设计稿名称",
  "size": {
    "width": 1024,
    "height": 1920
  },
  "layers": [
    {
      "id": "psd_41",
      "name": "按钮",
      "type": "layer",
      "visible": true,
      "opacity": 1,
      "position": { "left": 345, "top": 1684 },
      "size": { "width": 373, "height": 137 },
      "bounds": { "left": 345, "top": 1684, "right": 718, "bottom": 1821 },
      "image": "layer_sources/layer_0_button.png",
      "thumbnail": "thumb/layer_0_button.png"
    },
    {
      "id": "layer_1",
      "name": "标题文本",
      "type": "text",
      "position": { "left": 100, "top": 50 },
      "size": { "width": 200, "height": 40 },
      "text": {
        "content": "欢迎使用",
        "fontSize": 24,
        "color": [0, 0, 0, 255]
      }
    }
  ]
}
```

## AI 使用示例

转换完成后，使用生成的 README.md 中的 prompt 模板：

```
我有一个设计稿的布局数据，请阅读 layout.json 文件了解所有图层的位置和尺寸信息。

设计稿尺寸：1024x1920px
图层数量：9

请查看 thumb/ 目录下的缩略图来理解每个图层的视觉内容（缩略图是压缩版本，适合 AI 快速读取）。
完整的预览图在 preview.png，可以查看整体效果。

根据这些信息，帮我生成对应的 HTML/CSS 代码
```

## 常见用途

1. **生成代码** - 让 AI 根据布局生成 HTML/CSS/React 等代码
2. **设计分析** - 分析设计规范、间距、对齐关系
3. **响应式适配** - 基于原始布局生成响应式设计方案
4. **组件拆分** - 识别可复用的 UI 组件
5. **设计还原** - 对比设计稿和实现的差异

## 为什么使用缩略图？

- **文件更小** - 缩略图大小通常是原图的 1/2-1/3，AI 读取更快
- **信息足够** - 对于理解布局和内容，缩略图已经提供足够的视觉信息
- **节省资源** - 减少 token 消耗和处理时间

## 技术栈

- [psd](https://github.com/meltingice/psd.js) - PSD 文件解析
- [sharp](https://github.com/lovell/sharp) - 高性能图像处理

## 开发

```bash
# 克隆仓库
git clone https://github.com/citizenll/psd2ai.git
cd psd2ai

# 安装依赖
npm install

# 本地测试
node index.js test.psd output

# 发布到 npm
npm publish
```

## License

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！

## 相关项目

- [psd.js](https://github.com/meltingice/psd.js) - PSD 文件解析库
- [ag-psd](https://github.com/Agamnentzar/ag-psd) - 另一个 PSD 解析库
