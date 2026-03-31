# Vue 适配器

## 使用场景

- 当前端区域是 Vue 应用时使用
- Vue 2 和 Vue 3 均支持
- 使用 JavaScript 或 TypeScript
- 支持组合式 API (Composition API) 和选项式 API (Options API)

## 关注点

- 路由入口（Vue Router）
- 组件树和组件关系
- Store 绑定（Vuex / Pinia）
- 请求客户端（Axios / Fetch）
- 共享契约类型
- 指令和插件

## 当前能力

### 路由识别

识别 Vue Router 定义：

```javascript
// router/index.js
const routes = [
  { path: '/', component: Home },
  { path: '/user/:id', component: User },
  { path: '/about', component: About }
]

// 或 Composition API 风格
const router = createRouter({
  history: createWebHistory(),
  routes
})
```

生成的节点：
- `route` - 路由定义
- `component` - 页面组件

### 组件识别

识别 Vue 单文件组件：

```vue
<!-- Options API -->
<script>
export default {
  name: 'UserProfile',
  props: ['userId'],
  data() {
    return { user: null }
  },
  methods: {
    async fetchUser() {
      this.user = await api.getUser(this.userId)
    }
  },
  mounted() {
    this.fetchUser()
  }
}
</script>

<!-- Composition API -->
<script setup>
import { ref, onMounted } from 'vue'
import { useStore } from 'vuex'

const props = defineProps(['userId'])
const user = ref(null)
const store = useStore()

const fetchUser = async () => {
  user.value = await store.dispatch('user/fetchUser', props.userId)
}

onMounted(fetchUser)
</script>
```

生成的节点：
- `component` - Vue 组件
- `method` - 组件方法
- `prop` - 组件属性

### Store 绑定

识别 Vuex/Pinia 状态管理：

```javascript
// Vuex
const store = createStore({
  state: { user: null },
  mutations: {
    SET_USER(state, user) { state.user = user }
  },
  actions: {
    async fetchUser({ commit }, userId) {
      const user = await api.getUser(userId)
      commit('SET_USER', user)
      return user
    }
  }
})

// Pinia
defineStore('user', {
  state: () => ({ user: null }),
  actions: {
    async fetchUser(userId) {
      this.user = await api.getUser(userId)
    }
  }
})
```

生成的节点：
- `state` - 状态定义
- `mutation` - 状态变更
- `action` - 异步操作

### HTTP 请求

识别常见请求模式：

```javascript
// Axios
axios.get('/api/users').then(res => res.data)
axios.post('/api/users', userData)

// Fetch
fetch('/api/users').then(res => res.json())

// 封装的服务层
import { userApi } from '@/api'
userApi.getUser(userId)
```

生成的节点：
- `request` - 请求定义
- `endpoint` - 服务端点

### 组件间通信

识别事件和 provide/inject：

```javascript
// 事件派发
this.$emit('update:user', newUser)
emit('custom-event', payload)

// 事件监听
@update:user="handleUpdate"
@custom-event="handleCustom"

// Provide/Inject
provide('userKey', userData)
const user = inject('userKey')
```

生成的边：
- `emits` - 事件派发
- `subscribes` - 事件监听

## 推荐配置

### Vue 3 + TypeScript 项目

```json
{
  "featureKey": "frontend-vue",
  "featureName": "Vue Frontend",
  "scanTargets": {
    "components": ["src/components/**/*.vue", "src/views/**/*.vue"],
    "routes": ["src/router/**/*.ts"],
    "stores": ["src/stores/**/*.ts", "src/store/**/*.ts"],
    "api": ["src/api/**/*.ts"],
    "composables": ["src/composables/**/*.ts"]
  },
  "extractorAdapter": "generic",
  "includePatterns": ["**/*.vue", "**/*.ts"],
  "excludePatterns": ["**/*.spec.ts", "**/*.test.ts"]
}
```

### Vue 2 项目

```json
{
  "featureKey": "frontend-vue2",
  "featureName": "Vue 2 Frontend",
  "scanTargets": {
    "components": ["src/components/**/*.vue", "src/views/**/*.vue"],
    "routes": ["src/router/**/*.js"],
    "stores": ["src/store/**/*.js"],
    "mixins": ["src/mixins/**/*.js"]
  },
  "extractorAdapter": "generic"
}
```

## 最佳实践

1. **目录结构**
   ```
   src/
   ├── components/     # 可复用组件
   ├── views/          # 页面级组件
   ├── router/         # 路由配置
   ├── store/          # 状态管理 (Vuex)
   ├── stores/         # 状态管理 (Pinia)
   ├── api/            # API 接口层
   ├── composables/    # 组合式函数
   ├── utils/          # 工具函数
   └── assets/         # 静态资源
   ```

2. **组件命名**
   - 使用 PascalCase：`UserProfile.vue`
   - 语义清晰：`UserList` 而非 `List`

3. **Props 定义**
   ```typescript
   // 推荐：详细定义
   defineProps({
     userId: { type: String, required: true },
     showAvatar: { type: Boolean, default: true }
   })
   ```

4. **组件通信**
   - Props 向下传递
   - 事件向上派发
   - 跨层级使用 Provide/Inject 或 Store

5. **请求封装**
   ```javascript
   // 推荐：统一封装 API 层
   export const userApi = {
     getUser: (id) => api.get(`/users/${id}`),
     updateUser: (id, data) => api.put(`/users/${id}`, data)
   }
   ```

## 局限性

- 动态路由（运行时生成）可能无法完全识别
- 复杂的混入 (mixins) 模式可能追踪不完整
- 运行时组件注册可能无法静态分析

## 与其他适配器配合

- 与 `fullstack` 适配器配合，处理前后端混合项目
- 后端使用 `node`、`java-spring` 或 `python` 适配器
