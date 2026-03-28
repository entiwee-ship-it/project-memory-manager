# Cocos 适配器

## 使用场景

- 当前端区域是 Cocos Creator 项目时使用
- 当 prefab 绑定与组件脚本是主要入口时使用

## 关注点

- prefab 根节点
- 自定义组件
- click / toggle / 列表渲染事件绑定
- VM 路径
- 事件总线链路

## 当前能力

当前抽取器已经支持读取 Cocos prefab 与 TypeScript 脚本，并补充了以下前端语义：

- auto 模式下，如果 `methodRoots` / `assetRoots` 指向 `assets/` 或 `oops-plugin-framework/assets` 结构，即使没有 prefab 输入，也会优先选择 `cocos` 适配器
- `db://assets/...` 与 `db://oops-framework/...` 导入解析
- 跨文件静态 API 调用，例如 `PayApi.getOrderPayment()`、`UserApi.login()` 的 `calls` 建边
- 前端 HTTP 请求抽取，当前支持：
  - `HttpClient.getInstance().get/post/put/delete(url, ...)`
  - `HttpClient.getInstance().request({ url, method, ... })`
  - `fetch(url, init?)`
  - `axios.get/post/put/delete(url, ...)`
  - `axios.request({ url, method, ... })`
  - `axios({ url, method, ... })`

## 当前限制

- 动态拼接后的 URL 目前只保留原始表达式，不做跨变量求值
- `HttpClient.getInstance().request(config)` 这类“config 变量来自更早赋值”的场景，还不会反推出内层 `url/method`
- 还没有实现前后端自动联查；前端 `request` 节点与后端 `endpoint/route` 节点仍需分别查询
