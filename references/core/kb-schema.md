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
- `state`
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
- endpoint / route / table 的 `--type` / `--name` / `--from --direction` 查询
- upstream 遍历
- downstream 遍历
- component -> binds(handler / sourceEventKind)
- state -> readers / writers
- tag / 语义标签检索
