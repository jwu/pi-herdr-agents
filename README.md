# pi-herdr-core

在 Herdr Core（`hc`）终端内，用 Pi 启动交互式子代理、派发任务、互传消息和管理子终端。

## 使用

需要 `hc` 0.1.21 或更新版本、Pi 1.6 或更新版本，并且 `hc` 和 `pi` 都在 Pi 的 `PATH` 上。先配置 Pi 的模型，再在本项目目录启动父代理。

```sh
hc run --bg --name pi-lead -- "$(command -v pi)" -e "$PWD"
hc attach pi-lead
```

如果 Pi 已在 hc 终端内，可以用 `pi -e .` 加载本项目，或用 `pi install .` 将其加入 Pi 的包配置。工具在存在 `HC_TERMINAL_ID` 时注册。`hc_run` 会给新 Pi 显式加载同一个扩展，并使用子进程自身的模型配置。

| 工具 | 用法 |
| --- | --- |
| `hc_run` | 传入 `name`、`task` 和可选的 `cwd`，创建当前终端的子代理。Pi 空闲后才投递首条任务。 |
| `hc_agents` | 查看自己、父代理、直接子代理和同级代理的 hc 地址与状态。`include_finished` 可列出已结束的子代理和同级代理。 |
| `hc_send` | 传入 `message`。省略 `target` 时发给父代理，填地址时可发给直接子代理或同级代理。运行中的 Pi 会把它当作引导消息。 |
| `hc_wait` | 等待指定 `target`，或用 `children: "any"` / `"all"` 等待 hc 报告的直接子终端。收到新消息或达到超时都可能提前返回。 |
| `hc_manage` | 对自己启动的直接子代理执行 `read`、`interrupt`、`kill` 或 `rm`。`rm` 只移除已结束的终端。 |

可以让父代理分别委派代码审查和测试任务，给两个子代理各自的职责。子代理通过 `hc_agents` 发现同级地址，再用 `hc_send` 直接同步发现，并在完成或遇到阻塞时向父代理回报。用户可用 `hc attach <地址>` 进入任一终端。

消息通过 hc 投递到 Pi 的输入区。发送成功表示 hc 已投递，`started` 表示 hc 是否观察到新一轮工作。如果 `hc_run` 返回 `first_message.sent: false` 或 `null`，或观察到 `started: false`，先按返回地址查看终端。启动时的授权界面需要用户处理。若工具在发送期间被取消，可用 `hc_agents` 按名称找回已启动的终端。

子代理默认随父终端中的程序退出。当前工具围绕同一个 hc Core 内的代理协作。

## 本地开发

需要 Node.js 22.19 或更新版本和 Bun。

```sh
bun install
bun run lint
bun test
```

## 项目结构

- `extensions/index.ts` 是 Pi 扩展唯一入口。
- `extensions/hc-tools.ts` 注册工具，`extensions/hc-client.ts` 执行 hc 命令并解析终端关系。
- `tests/` 存放 Pi 包加载与工具行为测试。
