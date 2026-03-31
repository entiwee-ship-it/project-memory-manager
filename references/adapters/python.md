# Python 适配器

## 使用场景

- Python 后端服务
- FastAPI / Flask / Django 项目
- 数据处理管道
- AI/ML 服务

## 关注点

- HTTP 路由和视图函数
- 类和方法定义
- 模块导入关系
- 数据库模型（SQLAlchemy、Django ORM）
- 异步任务（Celery）

## 当前能力

### Web 框架支持

#### FastAPI

```python
from fastapi import FastAPI

app = FastAPI()

@app.get("/items/{item_id}")
async def read_item(item_id: int):
    return {"item_id": item_id}

@app.post("/items/")
async def create_item(item: Item):
    return item
```

#### Flask

```python
from flask import Flask

app = Flask(__name__)

@app.route('/users', methods=['GET'])
def get_users():
    return jsonify(users)

@app.route('/users', methods=['POST'])
def create_user():
    # 创建用户
    pass
```

#### Django

```python
# views.py
from django.http import JsonResponse

def user_list(request):
    users = User.objects.all()
    return JsonResponse({'users': list(users)})

# urls.py
urlpatterns = [
    path('users/', user_list, name='user_list'),
]
```

生成的节点：
- `endpoint` - HTTP 端点
- `view` - 视图函数/类

### 数据库访问

#### SQLAlchemy

```python
from sqlalchemy import create_engine, Column, Integer, String
from sqlalchemy.orm import sessionmaker

class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True)
    name = Column(String)

# 查询
session.query(User).filter(User.id == 1).first()
```

#### Django ORM

```python
# 查询
User.objects.filter(is_active=True)
User.objects.create(username='john')
```

生成的节点：
- `model` - ORM 模型
- `table` - 数据库表

生成的边：
- `reads` - 读操作
- `writes` - 写操作

### 异步任务

识别 Celery 任务：

```python
from celery import Celery

app = Celery('tasks')

@app.task
def send_email(user_id):
    # 发送邮件
    pass

# 调用
send_email.delay(user_id)
```

生成的节点：
- `task` - 异步任务
- `job` - 定时任务

## 推荐配置

### FastAPI 项目

```json
{
  "featureKey": "fastapi-backend",
  "featureName": "FastAPI Backend",
  "scanTargets": {
    "routes": ["routers/**/*.py"],
    "models": ["models/**/*.py"],
    "services": ["services/**/*.py"]
  },
  "extractorAdapter": "python"
}
```

### Django 项目

```json
{
  "featureKey": "django-app",
  "featureName": "Django Application",
  "scanTargets": {
    "views": ["*/views.py"],
    "models": ["*/models.py"],
    "urls": ["*/urls.py"]
  },
  "extractorAdapter": "python"
}
```

## 最佳实践

1. **明确的模块结构**
   ```
   project/
   ├── app/
   │   ├── __init__.py
   │   ├── models.py
   │   ├── views.py
   │   └── urls.py
   ├── config/
   └── requirements.txt
   ```

2. **类型注解**
   ```python
   def get_user(user_id: int) -> User:
       ...
   ```

3. **清晰的导入路径**
   ```python
   # 推荐
   from app.models import User
   
   # 避免相对导入
   from ..models import User
   ```

## 局限性

- 动态导入（`__import__`、`importlib`）可能无法追踪
- 复杂的元类或装饰器模式可能需要手动标注
- 运行时路由注册可能无法静态分析
