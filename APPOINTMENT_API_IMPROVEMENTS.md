# 预约查询API实现说明

## 概述

本文档详细说明了北交大校医院挂号系统中用户预约查询功能的实现。根据API规范要求，我们实现了两个核心接口：查询用户预约列表和查询预约详情。这两个接口专门查询用户预约记录表(tb_appointment)，而不是医生排班记录。

## 重要说明

### 统一响应格式

所有接口返回统一的格式：`{code, message, data}`

| 字段名 | 类型 | 说明 |
|--------|------|------|
| code | number | 状态码，表示请求的处理结果 |
| message | string | 响应消息，提供关于请求结果的人类可读描述 |
| data | any | 响应数据，成功时包含请求的数据，失败时通常为null或错误详情 |

### 认证要求

所有接口需要在请求头中携带有效JWT令牌：
```
Authorization: Bearer <JWT令牌>
```

### 预约操作特殊说明

预约操作会更新排班的余号数，建议在预约前先查询最新的排班状态，确保有余号。推荐流程：
1. 查询可预约排班：`GET /api/appointments/available-schedules`
2. 确认排班状态（检查`availableCount`字段）
3. 发起预约请求：`POST /api/appointments`
4. 处理预约结果

系统使用数据库事务确保并发情况下的数据一致性。

## 改进的API接口

### 1. 查询用户预约列表

**接口路径**: `/api/appointments/user`  
**请求方法**: `GET`  
**认证要求**: 需要用户登录  

#### 请求参数
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| status | string | 否 | 预约状态筛选：pending(待就诊)、called(已叫号)、completed(已完成)、cancelled(已取消)、missed(已过号) |
| page | number | 否 | 页码，默认为1 |
| limit | number | 否 | 每页记录数，默认为10 |

#### 请求示例
```
GET /api/appointments/user?status=pending&page=1&limit=5
```

#### 响应示例
```json
{
  "code": 200,
  "message": "查询成功",
  "data": {
    "appointments": [
      {
        "appointmentId": 1,
        "doctorName": "张医生",
        "doctorTitle": "主治医师",
        "departmentName": "内科",
        "scheduleDate": "2025-11-10",
        "timeSlot": "AM",
        "serialNumber": 5,
        "status": "pending",
        "statusDescription": "待就诊",
        "appointmentTime": "2025-11-06T10:30:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 5,
      "total": 15,
      "totalPages": 3
    }
  }
}
```

#### 功能增强
- **分页功能**: 支持分页查询，提高大数据量下的响应性能
- **状态筛选**: 可按预约状态进行筛选查询
- **状态描述**: 增加状态描述字段，提供更友好的中文状态显示
- **医生职称**: 增加医生职称信息

### 2. 查询预约详情

**接口路径**: `/api/appointments/:apptId`  
**请求方法**: `GET`  
**认证要求**: 需要用户登录  

#### 请求参数
| 参数名 | 位置 | 类型 | 必填 | 说明 |
|--------|------|------|------|------|
| apptId | 路径 | number | 是 | 预约ID |

#### 请求示例
```
GET /api/appointments/1
```

#### 响应示例
```json
{
  "code": 200,
  "message": "查询成功",
  "data": {
    "appointmentId": 1,
    "doctorName": "张医生",
    "doctorTitle": "主治医师",
    "departmentName": "内科",
    "scheduleDate": "2025-11-10",
    "timeSlot": "AM",
    "serialNumber": 5,
    "status": "pending",
    "statusDescription": "待就诊",
    "appointmentTime": "2025-11-06T10:30:00.000Z",
    "waitingCount": 4,
    "queuePosition": 5,
    "estimatedTime": "10:15"
  }
}
```

#### 功能增强
- **等待人数**: 显示当前用户前面还有多少人在等待
- **队列位置**: 显示用户在当前队列中的位置
- **预计就诊时间**: 根据等待人数和平均就诊时间计算预计就诊时间
- **状态描述**: 增加状态描述字段，提供更友好的中文状态显示
- **医生职称**: 增加医生职称信息

## 技术实现

### 核心代码位置

- **控制器**: `src/controllers/appointmentController.js`
  - `getUserAppointments` - 查询用户预约列表逻辑
  - `getAppointmentDetail` - 查询预约详情逻辑

- **路由**: `src/routes/appointmentRoutes.js`
  - `/user` - 用户预约列表路由
  - `/:apptId` - 预约详情路由

### 数据查询流程

这两个API接口的查询流程如下：

1. **从用户预约记录表(tb_appointment)开始查询**
2. **通过scheduleId关联到排班表(tb_schedule)**
3. **通过doctorId关联到医生表(tb_doctor)**
4. **通过userId关联到用户表(tb_user)**，获取医生姓名
5. **通过deptId关联到科室表(tb_department)**，获取科室名称

### 关键查询逻辑

#### 1. 查询用户预约记录（基于tb_appointment表）
```javascript
// 查询条件：用户ID、有效性标记
const whereClause = { userId, isValid: 1 };
if (status) {
  whereClause.status = status;
}

// 查询预约记录，包含关联信息
const appointments = await Appointment.findAll({
  where: whereClause,
  limit: parseInt(limit),
  offset: offset,
  order: [['appointmentTime', 'DESC']],
  include: [
    {
      model: Schedule,
      required: true, // 使用INNER JOIN确保必须有排班记录
      include: [
        {
          model: Doctor,
          required: true, // 使用INNER JOIN确保必须有医生记录
          include: [
            { 
              model: Department, 
              required: true, // 使用INNER JOIN确保必须有科室记录
              attributes: ['deptId', 'deptName'] 
            },
            { 
              model: User, 
              required: true, // 使用INNER JOIN确保必须有用户记录
              attributes: ['userId', 'username'] 
            }
          ]
        }
      ]
    }
  ]
});
```

#### 2. 处理关联数据安全性
```javascript
// 处理可能为null的关联数据
const doctor = appt.Schedule ? appt.Schedule.Doctor : null;
const department = doctor ? doctor.Department : null;
const user = doctor ? doctor.User : null;

return {
  // 基本信息
  appointmentId: appt.apptId,
  userId: appt.userId,
  
  // 医生信息
  doctorId: doctor ? doctor.doctorId : null,
  doctorName: user ? user.username : '未知医生',
  doctorTitle: doctor ? doctor.title : null,
  
  // 科室信息
  departmentId: department ? department.deptId : null,
  departmentName: department ? department.deptName : '未知科室',
  
  // 排班信息
  scheduleId: appt.Schedule ? appt.Schedule.scheduleId : null,
  scheduleDate: appt.Schedule ? appt.Schedule.scheduleDate : null,
  timeSlot: appt.Schedule ? appt.Schedule.timeSlot : null,
  
  // 预约信息
  serialNumber: appt.serialNumber,
  status: appt.status,
  statusDescription: getStatusDescription(appt.status),
  appointmentTime: appt.appointmentTime
};
```

### 关键技术点

1. **分页查询**
   ```javascript
   // 计算偏移量
   const offset = (parseInt(page) - 1) * parseInt(limit);
   
   // 查询预约总数（用于分页）
   const totalCount = await Appointment.count({ where: whereClause });
   
   // 查询预约列表
   const appointments = await Appointment.findAll({
     where: whereClause,
     limit: parseInt(limit),
     offset: offset,
     order: [['appointmentTime', 'DESC']],
     include: [/* 关联模型 */]
   });
   ```

2. **等待人数和预计就诊时间计算**
   ```javascript
   // 计算前面等待人数
   const waitingCount = relatedAppointments.filter(appt => 
     appt.status === 'pending' && appt.serialNumber < appointment.serialNumber
   ).length;
   
   // 计算预计就诊时间
   function calculateEstimatedTime(scheduleDate, timeSlot, waitingCount) {
     const baseTime = timeSlot === 'AM' ? '09:00' : '14:00';
     const averageConsultationTime = 15; // 平均就诊时间15分钟
     const waitingTime = waitingCount * averageConsultationTime;
     
     const [hours, minutes] = baseTime.split(':').map(Number);
     const date = new Date(scheduleDate);
     date.setHours(hours, minutes + waitingTime);
     
     return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
   }
   ```

3. **状态描述映射**
   ```javascript
   function getStatusDescription(status) {
     const statusMap = {
       'pending': '待就诊',
       'called': '已叫号',
       'completed': '已完成',
       'cancelled': '已取消',
       'missed': '已过号'
     };
     return statusMap[status] || '未知状态';
   }
   ```

## 安全考虑

1. **身份验证**
   - 所有接口都需要用户登录后才能访问
   - 只能查询当前用户自己的预约信息

2. **数据验证**
   - 参数验证确保请求的合法性
   - 分页参数限制防止一次性查询过多数据

3. **错误处理**
   - 统一错误响应格式
   - 敏感信息不在错误信息中泄露

## 测试建议

1. **单元测试**
   - 测试分页逻辑
   - 测试状态筛选功能
   - 测试等待人数和预计时间计算

2. **集成测试**
   - 测试完整的查询流程
   - 测试不同状态的预约查询

3. **性能测试**
   - 测试大数据量下的分页查询性能
   - 测试并发查询下的系统稳定性

## 未来改进方向

1. **缓存机制** - 对于频繁查询的数据使用缓存提高响应速度
2. **WebSocket** - 实现实时排队状态更新，用户无需刷新页面即可看到最新状态
3. **智能调度** - 根据医生平均就诊时间动态调整预计时间算法
4. **多条件筛选** - 支持更多筛选条件组合查询