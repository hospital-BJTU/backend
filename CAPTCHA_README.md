# 验证码模块使用说明

## 功能概述

本模块实现了一个完整的图片验证码系统，包含以下功能：
- 生成四位数字验证码图片（SVG格式）
- 验证用户输入的验证码
- 验证码过期管理（5分钟有效期）
- 一次性使用机制
- 开发调试接口

## 文件结构（已集成到本项目）

```
backend/
├── src/
│   ├── controllers/
│   │   └── captchaController.js    # 验证码控制器
│   └── routes/
│       └── captchaRoutes.js        # 验证码路由
└── CAPTCHA_README.md               # 本说明文档
```

## API接口

### 1. 生成验证码
- 接口: `GET /api/captcha/generate`
- 功能: 生成四位数字验证码图片
- 返回格式:
```json
{
  "success": true,
  "data": {
    "captchaId": "uuid-string",
    "image": "data:image/svg+xml;base64,..."
  },
  "message": "验证码生成成功"
}
```

### 2. 验证验证码
- 接口: `POST /api/captcha/verify`
- 参数:
```json
{
  "captchaId": "uuid-string",
  "code": "1234"
}
```
- 返回格式:
```json
{
  "success": true,
  "message": "验证结果信息"
}
```

### 3. 获取统计信息（开发调试用）
- 接口: `GET /api/captcha/stats`
- 功能: 获取当前存储的验证码统计信息
- 返回格式:
```json
{
  "success": true,
  "data": {
    "totalCaptchas": 3,
    "captchas": [
      {
        "id": "uuid-string",
        "code": "1234",
        "createdAt": "2023-10-29T10:12:42.000Z",
        "expiresAt": "2023-10-29T10:17:42.000Z"
      }
    ]
  }
}
```

## 前端使用示例

### HTML结构
```html
<div>
  <img id="captcha-image" alt="验证码" width="120" height="40">
  <button onclick="refreshCaptcha()">刷新验证码</button>
  <input type="text" id="captcha-input" placeholder="请输入验证码" maxlength="4">
  <button onclick="verifyCaptcha()">验证</button>
  </div>
```

### JavaScript代码
```javascript
let currentCaptchaId = null;

// 生成验证码
async function refreshCaptcha() {
  try {
    const response = await fetch('/api/captcha/generate');
    const data = await response.json();
    
    if (data.success) {
      currentCaptchaId = data.data.captchaId;
      document.getElementById('captcha-image').src = data.data.image;
    }
  } catch (error) {
    console.error('生成验证码失败:', error);
  }
}

// 验证验证码
async function verifyCaptcha() {
  const code = document.getElementById('captcha-input').value;
  
  if (!code || !currentCaptchaId) {
    alert('请先生成验证码并输入');
    return false;
  }
  
  try {
    const response = await fetch('/api/captcha/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ captchaId: currentCaptchaId, code })
    });
    
    const data = await response.json();
    
    if (data.success) {
      return true;
    } else {
      alert('验证码错误：' + data.message);
      refreshCaptcha();
      return false;
    }
  } catch (error) {
    console.error('验证失败:', error);
    return false;
  }
}

// 页面加载时生成验证码
window.onload = refreshCaptcha;
```

## 生产环境优化建议

- 使用 Redis 存储并设置过期时间
- 为生成接口添加请求频率限制
- 进一步增强图片复杂度

## 故障排除

- 端口是否被占用、依赖是否安装、数据库配置是否正确
- 图片不显示：检查返回是否为有效 base64 数据、CORS 设置
- 总是失败：检查过期、`captchaId` 是否正确、输入格式


