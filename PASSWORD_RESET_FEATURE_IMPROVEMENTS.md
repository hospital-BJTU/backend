# 找回密码功能改进说明

## 概述

本文档详细说明了北交大校医院挂号系统中找回密码功能的改进与实现。该功能为用户提供了一种安全、便捷的密码重置方式，通过手机短信验证确保身份真实性。

## 功能特点

### 1. 三步式找回密码流程
- **第一步：发送验证码** - 用户输入手机号，系统发送短信验证码
- **第二步：验证验证码** - 用户输入收到的验证码，系统验证其有效性
- **第三步：重置密码** - 验证通过后，用户可设置新密码

### 2. 安全性增强
- **JWT令牌机制** - 使用临时令牌(tempToken)和重置令牌(resetToken)确保操作安全
- **令牌时效性** - 临时令牌10分钟有效，重置令牌15分钟有效
- **手机号格式验证** - 验证手机号格式是否符合中国大陆手机号规范
- **密码强度校验** - 要求新密码至少6位长度
- **身份一致性检查** - 验证用户信息与数据库记录的一致性

### 3. 短信服务集成
- **自定义SMS服务** - 通过`utils/smsService.js`实现短信发送与验证
- **验证码存储** - 验证码存储在数据库中，便于后续验证
- **业务场景区分** - 支持不同业务场景(如注册、密码重置)的验证码管理

## 技术实现

### API接口设计

| 接口路径 | 方法 | 功能 | 参数 |
|---------|------|------|------|
| `/users/send-code` | POST | 发送验证码 | phone |
| `/users/verify-code` | POST | 验证验证码 | tempToken, code |
| `/users/reset-password` | POST | 重置密码 | resetToken, newPassword |

### 核心代码位置

- **控制器**: `src/controllers/userController.js`
  - `sendVerificationCode` - 发送验证码逻辑
  - `verifyCode` - 验证验证码逻辑
  - `resetPassword` - 重置密码逻辑

- **路由**: `src/routes/userRoutes.js`
  - 找回密码相关的API路由定义

- **工具**: `src/utils/smsService.js`
  - `sendVerificationSms` - 发送验证码
  - `verifySmsCode` - 验证验证码

### 数据库模型

找回密码功能使用了以下数据模型：
- `User` - 用户基本信息(包含手机号字段)
- `SmsVerification` - 存储短信验证码记录

### 数据库更改

#### 1. 用户表(tb_user)添加手机号字段

为了支持找回密码功能，我们向用户表添加了手机号字段，用于接收短信验证码。

**SQL修改语句：**
```sql
ALTER TABLE tb_user ADD COLUMN phone VARCHAR(20) COMMENT '手机号';
```

**字段详细说明：**
- 字段名：`phone`
- 数据类型：`VARCHAR(20)`
- 允许值：符合中国大陆手机号格式(1开头的11位数字)
- 是否必填：是
- 唯一性：建议添加唯一索引，确保一个手机号只能注册一个账号
- 索引建议：
  ```sql
  CREATE UNIQUE INDEX idx_user_phone ON tb_user(phone);
  ```

#### 2. 短信验证码表(tb_sms_verification)设计

为了存储短信验证码，我们设计了一个新表来记录验证码信息。

**表结构：**
```sql
CREATE TABLE tb_sms_verification (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  phone VARCHAR(20) NOT NULL COMMENT '手机号',
  code VARCHAR(10) NOT NULL COMMENT '验证码',
  type VARCHAR(50) NOT NULL COMMENT '验证码类型(register/reset_password等)',
  is_used TINYINT(1) DEFAULT 0 COMMENT '是否已使用(0:未使用,1:已使用)',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  expires_at DATETIME NOT NULL COMMENT '过期时间',
  used_at DATETIME NULL COMMENT '使用时间',
  INDEX idx_phone_type (phone, type),
  INDEX idx_expires_at (expires_at)
) COMMENT '短信验证码表';
```

#### 3. 数据迁移脚本

为了帮助现有系统升级，可以使用以下数据迁移脚本：

```sql
-- 步骤1: 添加手机号字段
ALTER TABLE tb_user ADD COLUMN phone VARCHAR(20) COMMENT '手机号';

-- 步骤2: 为现有用户分配测试手机号(仅用于测试环境)
-- 生产环境中应该要求用户自行绑定手机号
UPDATE tb_user SET phone = CONCAT('1551009', LPAD(id, 4, '0')) WHERE phone IS NULL OR phone = '';

-- 步骤3: 添加唯一索引
CREATE UNIQUE INDEX idx_user_phone ON tb_user(phone);

-- 步骤4: 创建短信验证码表
CREATE TABLE tb_sms_verification (
  id INT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  phone VARCHAR(20) NOT NULL COMMENT '手机号',
  code VARCHAR(10) NOT NULL COMMENT '验证码',
  type VARCHAR(50) NOT NULL COMMENT '验证码类型(register/reset_password等)',
  is_used TINYINT(1) DEFAULT 0 COMMENT '是否已使用(0:未使用,1:已使用)',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  expires_at DATETIME NOT NULL COMMENT '过期时间',
  used_at DATETIME NULL COMMENT '使用时间',
  INDEX idx_phone_type (phone, type),
  INDEX idx_expires_at (expires_at)
) COMMENT '短信验证码表';
```

#### 4. Sequelize模型更新

为了支持新的数据库结构，需要更新对应的Sequelize模型：

**用户模型更新(User.js):**
```javascript
// 在User模型定义中添加phone字段
phone: {
  type: DataTypes.STRING(20),
  allowNull: false,
  unique: true,
  comment: '手机号'
}
```

**新增短信验证模型(SmsVerification.js):**
```javascript
module.exports = (sequelize, DataTypes) => {
  const SmsVerification = sequelize.define('SmsVerification', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      comment: '主键ID'
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: false,
      comment: '手机号'
    },
    code: {
      type: DataTypes.STRING(10),
      allowNull: false,
      comment: '验证码'
    },
    type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: '验证码类型(register/reset_password等)'
    },
    isUsed: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: '是否已使用(0:未使用,1:已使用)'
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: '过期时间'
    },
    usedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '使用时间'
    }
  }, {
    tableName: 'tb_sms_verification',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    indexes: [
      {
        fields: ['phone', 'type']
      },
      {
        fields: ['expiresAt']
      }
    ]
  });

  return SmsVerification;
};
```

## 使用流程

1. **发送验证码**
   ```javascript
   POST /users/send-code
   Request Body: { "phone": "13800138000" }
   Response: {
     "code": 200,
     "message": "验证码发送成功",
     "data": { "tempToken": "eyJ..." }
   }
   ```

2. **验证验证码**
   ```javascript
   POST /users/verify-code
   Request Body: { 
     "tempToken": "eyJ...", 
     "code": "123456" 
   }
   Response: {
     "code": 200,
     "message": "验证码验证成功",
     "data": { "resetToken": "eyJ..." }
   }
   ```

3. **重置密码**
   ```javascript
   POST /users/reset-password
   Request Body: { 
     "resetToken": "eyJ...", 
     "newPassword": "newpass123" 
   }
   Response: {
     "code": 200,
     "message": "密码重置成功",
     "data": null
   }
   ```

## 安全考虑

1. **敏感信息保护**
   - 所有密码使用bcrypt加密存储
   - JWT密钥存储在环境变量中

2. **防暴力破解**
   - 验证码有时效性限制
   - 令牌机制限制重置操作顺序

3. **错误处理**
   - 统一错误响应格式
   - 敏感信息不在错误信息中泄露

## 配置要求

需要在`.env`文件中配置以下参数：
```
JWT_SECRET=your-secret-key
SMS_SERVICE_CONFIG=sms-config
```

## 测试建议

1. **单元测试**
   - 验证手机号格式验证逻辑
   - 测试密码加密与验证逻辑

2. **集成测试**
   - 测试完整的找回密码流程
   - 验证令牌生成与验证机制

3. **安全测试**
   - 测试令牌时效性
   - 验证错误处理机制

## 未来改进方向

1. **多渠道验证** - 支持邮箱验证码、安全问题等多种验证方式
2. **验证码限制** - 增加同一手机号发送验证码的频率限制
3. **日志记录** - 增加详细的操作日志，便于安全审计
4. **UI优化** - 提供更友好的前端界面，引导用户完成找回密码流程