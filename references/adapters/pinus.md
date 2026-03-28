# Pinus 适配器

## 使用场景

- 当后端区域是 Pinus 或类似消息驱动的 Node 游戏服务时使用

## 关注点

- handler 入口
- 房间与游戏逻辑服务
- 消息派发
- socket 协议
- 状态同步流程

## 当前能力

- 识别 `app/servers/<server>/handler/<file>.ts` 与 `app/servers/<server>/remote/<file>.ts` 的 Pinus 路由标签
- 抽取 `this.app.rpc.*.*.*` 与 `global.App.rpc.*.*.*` 形式的 RPC 调用
- 在构建 KB 时把 `handler -> request -> route -> remote` 串成可遍历链路
- 兼容后端配置里的 `serverRoots`、`moduleRoots`、`dbRoots` 与 `scanTargets`
- 识别 `app/http/routes/**/*.ts|js` 的 Express 路由，并生成 `endpoint` 节点
- 识别 `TableMsg.init()` 中的 `regHandler('cmd', this.handler)`，生成 `table-msg` 路由节点
- 识别 `notify`、`NotifyAll`、`channelService.pushMessageByUids` 的出站消息路由
- 识别 Drizzle 风格 `from/join/insert/update/delete` 表访问，并生成 `table` 节点与 `reads/writes` 边

## 推荐配置

- 目标仓库根已有 `project-memory/` 时，可在任意子目录运行 `node <skill-path>/scripts/build_chain_kb.js --config <config>`
- 像 `qyserver` 这类多入口后端，优先写 `scanTargets.handlers/remotes/modules/routes/schemas`
- 当配置文件就在目标仓库内时，优先使用相对 `scanTargets`
- 只有当脚本不在目标仓库内执行时，才使用外部仓库路径作为 `scanTargets`，并让 `extractorAdapter` 显式为 `pinus`
