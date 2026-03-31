# Java Spring 适配器

## 使用场景

- Spring Boot 后端项目
- Spring MVC REST API
- 使用 Java 或 Kotlin
- 企业级 Java 应用

## 关注点

- REST Controller 和端点
- Service 层业务逻辑
- Repository 数据访问
- Entity/Model 定义
- 配置和 Bean 定义

## 当前能力

### Controller 识别

识别 Spring MVC 注解：

```java
@RestController
@RequestMapping("/api/users")
public class UserController {
    
    @GetMapping
    public List<User> getUsers() { }
    
    @GetMapping("/{id}")
    public User getUser(@PathVariable Long id) { }
    
    @PostMapping
    public User createUser(@RequestBody User user) { }
    
    @PutMapping("/{id}")
    public User updateUser(@PathVariable Long id, @RequestBody User user) { }
    
    @DeleteMapping("/{id}")
    public void deleteUser(@PathVariable Long id) { }
}
```

生成的节点：
- `endpoint` - HTTP 端点
- `controller` - 控制器类

### Service 层

识别 Service 注解和调用：

```java
@Service
public class UserService {
    
    @Autowired
    private UserRepository userRepository;
    
    public User createUser(User user) {
        return userRepository.save(user);
    }
}
```

生成的节点：
- `service` - 服务类

生成的边：
- `calls` - 服务调用

### Repository 层

识别 Spring Data JPA：

```java
@Repository
public interface UserRepository extends JpaRepository<User, Long> {
    User findByUsername(String username);
    List<User> findByActiveTrue();
}
```

生成的节点：
- `repository` - 仓库接口
- `table` - 数据库表

### Entity 定义

识别 JPA 实体：

```java
@Entity
@Table(name = "users")
public class User {
    @Id
    @GeneratedValue
    private Long id;
    
    @Column(name = "user_name")
    private String username;
}
```

生成的节点：
- `entity` - 实体类
- `model` - 数据模型

## 推荐配置

```json
{
  "featureKey": "spring-backend",
  "featureName": "Spring Backend",
  "scanTargets": {
    "controllers": ["src/main/java/**/controller/**/*.java"],
    "services": ["src/main/java/**/service/**/*.java"],
    "repositories": ["src/main/java/**/repository/**/*.java"],
    "entities": ["src/main/java/**/entity/**/*.java"]
  },
  "extractorAdapter": "java-spring"
}
```

## 最佳实践

1. **分层架构**
   ```
   src/main/java/com/example/
   ├── controller/    # 控制层
   ├── service/       # 业务层
   ├── repository/    # 数据层
   ├── entity/        # 实体
   ├── dto/           # 数据传输对象
   └── config/        # 配置
   ```

2. **RESTful 设计**
   - 使用名词复数：`/users` 而非 `/getUsers`
   - 正确 HTTP 方法：GET、POST、PUT、DELETE
   - 状态码：200、201、204、400、404、500

3. **依赖注入**
   ```java
   // 推荐：构造器注入
   private final UserService userService;
   
   public UserController(UserService userService) {
       this.userService = userService;
   }
   ```

## 局限性

- 复杂的 AOP 切面可能无法完全追踪
- 动态查询（QueryDSL、Criteria API）可能解析不完整
- 异步处理（@Async、CompletableFuture）链路可能断裂
