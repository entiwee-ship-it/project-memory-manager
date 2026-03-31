# Node.js 适配器

## 使用场景

- 标准 Node.js 后端项目
- Express/Koa/Fastify 等 Web 框架
- 使用 JavaScript 或 TypeScript
- 不特定于游戏框架的通用后端

## 关注点

- HTTP 路由和端点
- 中间件链路
- 服务层调用
- 数据库访问
- 工具函数和共享库

## 当前能力

### 路由识别

识别 Express 风格的路由定义：

```javascript
// app.js 或 routes/*.js
app.get('/api/users', handler);
app.post('/api/users', createUser);
router.put('/:id', updateUser);
```

生成的节点：
- `endpoint` - HTTP 端点
- `route` - 路由定义

### 服务调用

识别服务层调用：

```javascript
const userService = require('./services/userService');
userService.createUser(data);
```

生成的边：
- `calls` - 服务调用关系

### 数据库访问

支持多种 ORM/查询方式：

```javascript
// Sequelize
User.findAll({ where: { active: true } });

// Mongoose
User.find({ status: 'active' });

// 原始 SQL
db.query('SELECT * FROM users WHERE active = ?', [true]);
```

生成的节点：
- `table` - 数据库表/集合
- `model` - ORM 模型

生成的边：
- `reads` - 读操作
- `writes` - 写操作

### 事件系统

识别 EventEmitter：

```javascript
// 事件订阅
emitter.on('user:created', handler);
eventEmitter.addListener('update', callback);

// 事件派发
emitter.emit('user:created', user);
```

生成的节点：
- `event` - 事件

生成的边：
- `subscribes` - 订阅关系
- `emits` - 派发关系

## 推荐配置

### 标准 Express 项目

```json
{
  "featureKey": "backend-api",
  "featureName": "Backend API",
  "scanTargets": {
    "routes": ["routes/**/*.js"],
    "services": ["services/**/*.js"],
    "models": ["models/**/*.js"],
    "middlewares": ["middlewares/**/*.js"]
  },
  "extractorAdapter": "node"
}
```

### 分层架构项目

```json
{
  "featureKey": "backend-core",
  "featureName": "Backend Core",
  "scanTargets": {
    "controllers": ["src/controllers/**/*.ts"],
    "services": ["src/services/**/*.ts"],
    "repositories": ["src/repositories/**/*.ts"],
    "entities": ["src/entities/**/*.ts"]
  },
  "extractorAdapter": "node",
  "includePatterns": ["**/*.ts"],
  "excludePatterns": ["**/*.test.ts", "**/*.spec.ts"]
}
```

## 最佳实践

1. **目录结构清晰**
   ```
   src/
   ├── controllers/    # HTTP 处理层
   ├── services/       # 业务逻辑层
   ├── repositories/   # 数据访问层
   ├── models/         # 数据模型
   ├── middlewares/    # 中间件
   └── utils/          # 工具函数
   ```

2. **有意义的函数名**
   - 使用 `verb + noun` 格式
   - 如 `createUser`, `validateToken`, `sendEmail`

3. **路由版本控制**
   ```javascript
   // 推荐
   app.use('/api/v1/users', userRoutes);
   
   // 不推荐
   app.get('/users', handler);
   ```

4. **错误处理中间件**
   ```javascript
   app.use((err, req, res, next) => {
     // 统一错误处理
   });
   ```

## 局限性

- 动态路由（运行时生成）可能无法完全识别
- 复杂的依赖注入模式可能需要手动标注
- 异步导入（`await import()`）可能追踪不完整

## 与其他适配器配合

- 与 `fullstack` 适配器配合，处理前后端混合项目
- 与 `pinus` 适配器区分，后者专为游戏服务器优化
