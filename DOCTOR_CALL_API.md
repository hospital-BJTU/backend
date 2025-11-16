# 医生叫号与过号接口文档

本文档描述医生端对预约进行叫号与过号的接口规范，包含请求路径、鉴权方式、参数、响应示例与错误码说明。

## 基本信息

- 基础路径：`/api/appointments`
- 鉴权方式：HTTP Header 携带 `Authorization: Bearer <JWT>`，且 `role` 必须为 `doctor`
- 权限约束：医生只能操作属于自己排班（`Schedule.doctor_id`）下的预约记录

## 状态流转规则

- `pending` → `called`（叫号）
- `called` → `missed`（过号）或 `completed`（接诊完成）
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

## 3. 接诊完成

- 方法与路径：`PUT /api/appointments/{apptId}/complete`
- 功能：将预约状态从 `called` 置为 `completed`，并记录一条接诊完成日志

### 请求

- Path 参数：
  - `apptId`：整数，预约ID
- Header：
  - `Authorization: Bearer <医生JWT>`

### 成功响应（200）

```json
{
  "code": 200,
  "message": "已标记接诊完成",
  "data": {
    "appointmentId": 123,
    "status": "completed",
    "statusDescription": "已完成"
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
curl -X PUT "http://localhost:<PORT>/api/appointments/123/complete" \
  -H "Authorization: Bearer <医生JWT>"
```

## 4. 医生队列查询

- 方法与路径：`GET /api/appointments/doctor/queue`
- 功能：按排班查询当前医生的就诊队列，用于前端列表展示

### 请求

- Query 参数（任选其一）
  - `scheduleId`：整数，排班ID
  - `date` + `timeSlot`：日期（`YYYY-MM-DD`）与班次（`AM`/`PM`）
- 可选参数：
  - `status`：逗号分隔的状态列表（默认 `pending,called`）
- Header：
  - `Authorization: Bearer <医生JWT>`

### 成功响应（200）

```json
{
  "code": 200,
  "message": "查询成功",
  "data": {
    "schedule": {
      "scheduleId": 1,
      "scheduleDate": "2025-11-13",
      "timeSlot": "AM",
      "doctorId": 10,
      "doctorName": "张三",
      "doctorTitle": "主任医师",
      "departmentName": "内科",
      "maxCount": 30,
      "availableCount": 12
    },
    "counts": {
      "pending": 8,
      "called": 3,
      "missed": 0,
      "completed": 1
    },
    "queue": [
      {
        "appointmentId": 1001,
        "patientId": 501,
        "patientName": "李四",
        "serialNumber": 1,
        "status": "pending",
        "statusDescription": "待就诊",
        "appointmentTime": "2025-11-13T01:23:45.000Z"
      }
    ],
    "total": 12
  }
}
```

### 可能错误

- 401 缺少或无效令牌
- 403 非医生或排班不属于该医生
- 404 未找到排班
- 400 参数缺失（未提供 `scheduleId` 或 `date+timeSlot`）
- 500 服务器内部错误

### 示例（curl）

```bash
curl -G "http://localhost:<PORT>/api/appointments/doctor/queue" \
  -H "Authorization: Bearer <医生JWT>" \
  --data-urlencode "scheduleId=1"
```

## 日志与审计

- 每次叫号/过号/接诊完成会在 `tb_call_log` 写入一条记录，字段包括：
  - `appt_id`（预约ID）
  - `doctor_id`（医生ID）
  - `operation`（`called`、`missed` 或 `completed`）
  - `operation_time`（时间戳）

- 说明：当前数据库结构下 `log_id` 为非自增主键，系统在写入前会查询 `MAX(log_id) + 1` 作为新日志主键，确保与既有记录不冲突。

## 备注

- `<PORT>` 为后端服务实际运行端口（默认 `3000`），可在 `.env` 或 `server.js` 中配置。
- 已实现接口：`PUT /api/appointments/{apptId}/complete`（仅对 `called` 允许），状态置为 `completed` 并记录日志。