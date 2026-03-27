# KB Schema

## 节点类型

- `module`
- `script`
- `class`
- `method`
- `component`
- `route`
- `endpoint`
- `service`
- `event`
- `request`
- `response`
- `dto`
- `model`
- `table`
- `config`
- `job`

## 边类型

- `contains`
- `binds`
- `calls`
- `field_calls`
- `subscribes`
- `emits`
- `vm_binds`
- `vm_emits`
- `requests`
- `callback_calls`
- `reads`
- `writes`
- `depends_on`

## 查询要求

需要直接支持：

- event -> subscribers / emitters
- method -> outgoing / incoming edges
- request -> callers
- upstream 遍历
- downstream 遍历
