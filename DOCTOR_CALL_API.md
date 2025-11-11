# 医生叫号与过号接口文档

本文档描述医生端对预约进行叫号与过号的接口规范，包含请求路径、鉴权方式、参数、响应示例与错误码说明。

## 基本信息

- 基础路径：`/api/appointments`
- 鉴权方式：HTTP Header 携带 `Authorization: Bearer <JWT>`，且 `role` 必须为 `doctor`
- 权限约束：医生只能操作属于自己排班（`Schedule.doctor_id`）下的预约记录

## 状态流转规则

- `pending` → `called`（叫号）
- `called` → `missed`（过号）或 `completed`（接诊完成，若后续需要可扩展）
- 取消预约由患者端接口处理（`cancelled`），不在本接口范围内

## 1. 医生叫号

- 方法与路径：`PUT /api/appointments/{apptId}/call`
- 功能：将预约状态从 `pending` 置为 `called`，并记录一条叫号日志

### 请求

- Path 参数：
  - `apptId`：整数，预约ID
- Header：
  - `Authorization: Bearer <医生JWT>`

### 成功响应（200）

```json
{
  "code": 200,
  "message": "叫号成功",
  "data": {
    "appointmentId": 123,
    "status": "called",
    "statusDescription": "已叫号"
  }
}
```

### 可能错误

- 401 缺少或无效令牌
- 403 非医生或预约不属于该医生排班
- 404 预约不存在或已失效
- 400 状态不允许（例如当前不是 `pending`）
- 500 服务器内部错误

### 示例（curl）

```bash
curl -X PUT "http://localhost:<PORT>/api/appointments/123/call" \
  -H "Authorization: Bearer <医生JWT>"
```

## 2. 医生过号

- 方法与路径：`PUT /api/appointments/{apptId}/miss`
- 功能：将预约状态从 `called` 置为 `missed`，并记录一条过号日志

### 请求

- Path 参数：
  - `apptId`：整数，预约ID
- Header：
  - `Authorization: Bearer <医生JWT>`

### 成功响应（200）

```json
{
  "code": 200,
  "message": "已标记过号",
  "data": {
    "appointmentId": 123,
    "status": "missed",
    "statusDescription": "已过号"
  }
}
```

### 可能错误

- 401 缺少或无效令牌
- 403 非医生或预约不属于该医生排班
- 404 预约不存在或已失效
- 400 状态不允许（例如当前不是 `called`）
- 500 服务器内部错误

### 示例（curl）

```bash
curl -X PUT "http://localhost:<PORT>/api/appointments/123/miss" \
  -H "Authorization: Bearer <医生JWT>"
```

## 日志与审计

- 每次叫号/过号会在 `tb_call_log` 写入一条记录，字段包括：
  - `appt_id`（预约ID）
  - `doctor_id`（医生ID）
  - `operation`（`called` 或 `missed`）
  - `operation_time`（时间戳）

## 备注

- `<PORT>` 为后端服务实际运行端口（默认 `3000`），可在 `.env` 或 `server.js` 中配置。
- 若需要“接诊完成”接口，可新增：`PUT /api/appointments/{apptId}/complete`，规则与上述相似（仅对 `called` 允许），状态置为 `completed` 并记录日志。