# OpenClaw Landing Bundle Prompt

该项目已经支持在 `/admin/settings/landing` 中配置以下内容：

- `landing_openclaw_prompt_en`
- `landing_openclaw_prompt_zh`
- HTML bundle 上传与语言 / 主题映射

推荐工作流：

1. 在后台选择目标语言与主题。
2. 使用对应提示词生成完整静态 HTML bundle。
3. 将产物打包为 zip，确保入口文件是 `index.html`。
4. 在后台上传 zip，并映射到 `locale:theme` 变体。

bundle 运行时会收到以下查询参数：

- `locale`
- `theme`
- `appearance`

提示词必须要求生成的静态页面：

- 仅使用相对资源路径
- 能在 `iframe` 中独立运行
- 使用 CSS 变量 `--primary` / `--secondary` / `--accent` / `--background` / `--foreground`
- 根据 `locale` / `theme` / `appearance` 自适应文案和样式
- 对移动端友好

如果你希望不同主题使用完全不同的页面风格，直接为每个 `locale:theme` 上传独立 zip 即可。
