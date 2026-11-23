# AGENTS.md

pi-herdr-core 是面向 Herdr 集成的 Pi 扩展包，使用 TypeScript 和 Bun。

- `extensions/index.ts` 是唯一入口。`hc-tools.ts` 注册 Pi 工具，`hc-client.ts` 负责执行 `hc` 命令和读取终端关系。
- `tests/` 存放 Bun 测试。Pi 包加载测试覆盖 `package.json` 声明的入口。
- 文档用简洁中文。TypeScript 使用 2 空格缩进、单引号和分号。
- 修改代码后运行 `bun run lint` 和 `bun test`。用 `bun run format` 格式化 TypeScript。
