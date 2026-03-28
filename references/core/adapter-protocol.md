# 适配器协议

## 目标

适配器协议用于把技能核心流程与技术栈、框架细节解耦。

核心原则：

- 技能主流程不包含单项目硬编码
- 技术特化通过适配器挂接
- 适配器返回事实，不写叙述
- 主流程总是可以在只有 `generic` 适配器的情况下运行

## 拓扑适配器

目录：

- `scripts/adapters/topology/`

### 最小接口

- `name`
- `classifyAreaFromPath(relativePath)`
- `canonicalAreaRoot(relativeDir, area)`
- `detectStacksFromManifest({ manifestName, pkg, manifestText, relativeDir })`
- `detectIntegrations(root)`

### 责任

- 识别 `frontend / backend / shared / contract / data / ops`
- 将原始目录归并为稳定区域根
- 从 manifest 和目录特征中推断主要技术栈
- 从项目结构中推断主要集成方式

## 抽取适配器

目录：

- `scripts/adapters/extract/`

### 最小接口

- `name`
- `resolveImportPath(specifier, scriptFile, context)`
- `collectScriptMeta(componentRoots, context)`
- `collectPrefabMeta(assetRoots, context)`
- `collectAssetMeta(assetRoots, context)`

### 可选扩展

- `collectRoutes`
- `collectEndpoints`
- `collectServices`
- `collectModels`
- `collectContracts`

### 责任

- 提供技术栈相关的导入路径解析
- 提供脚本元数据与资源元数据补充能力
- 对需要 UUID 反解的框架，返回脚本 / prefab / 资源的可追踪映射
- 让主抽取器在统一 KB schema 下输出事实

## 演进规则

- `generic` 是默认基础适配器
- 技术适配器是增强，不是默认世界观
- 单项目适配器不是默认设计方向
- 若确实存在单项目适配器，也只能作为外部扩展，不进入技能主分支
