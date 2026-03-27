# 接管手册

## 目标

把一个几乎没有 AI 记忆体系的仓库，快速接管成可持续开发的 AI 工作空间。

## 默认顺序

1. 识别项目拓扑
2. 创建项目记忆根目录
3. 建立 docs / KB / state / reports / legacy 结构
4. 建立轻入口 `AGENTS.md`
5. 建立 active work 机制
6. 建立第一份 KB 配置和第一个 feature KB
7. 默认从 docs 开始编码；遇到入口、调用链、事件绑定、状态流转问题时优先查询 KB；只有 docs 与 KB 都不足时才做大范围搜索

## 适配器原则

- 默认先使用 `generic` 适配器
- 只有当技术栈特征足够明确时，才附加技术适配器
- 不为单一项目保留默认特化适配器
- 适配器接口说明见 `adapter-protocol.md`

## 目标产物

- 仓库入口：`AGENTS.md`
- docs 根：`project-memory/docs`
- KB 根：`project-memory/kb`
- state 根：`project-memory/state`
- 协议根：`project-memory/SYSTEM`

## 首批决策

- 将项目归类为 `single-stack / full-stack / multi-service`
- 识别区域根目录
- 记录各区域技术栈
- 记录主要协同方式
