# 防抢号功能测试方案

## 1. 测试目的

验证系统中实现的防抢号功能是否正常工作，确保预约挂号流程的公平性和安全性，防止恶意用户通过各种方式抢占号源。测试将覆盖所有已实现的防抢号机制，包括用户短时间频繁预约限制、IP限流、验证码验证、并发预约安全性等。测试方案提供详细的Postman操作步骤，确保测试过程可重现、可验证。

## 2. 测试环境

- **开发环境**：本地开发环境
- **测试环境**：预发布测试环境
- **数据库**：MySQL + Redis
- **API测试工具**：Postman 或类似工具
- **并发测试工具**：可使用 scripts/concurrency_test.js 脚本

## 3. 测试范围

测试范围包括但不限于：

1. 用户短时间频繁预约限制机制
2. IP限流机制
3. 验证码验证机制
4. 并发预约安全性保障
5. 黑名单机制
6. 防抢号日志记录功能

## 4. 测试用例设计

### 4.1 用户短时间频繁预约限制测试

基于代码中实现的逻辑：系统会检查用户在5分钟内是否有超过2次的有效预约记录（状态为pending或called），如果超过限制，则拒绝新的预约请求并记录可疑行为。

#### 测试用例1: 正常预约测试
**Postman测试步骤**：
1. **用户登录**：
   - 打开Postman，创建新的请求
   - 请求方法：POST
   - URL：`http://localhost:3000/api/users/login`
   - 请求体（JSON）：
     ```json
     {
       "phone": "13800138001",
       "password": "password123"
     }
     ```
   - 点击"Send"按钮
   - 从响应中复制JWT token（在响应体的`token`字段）

2. **获取验证码**：
   - 创建新的GET请求
   - URL：`http://localhost:3000/api/captcha/generate`
   - 点击"Send"按钮
   - 从响应中复制captchaId，从验证码图片中读取captchaCode

3. **提交预约请求**：
   - 创建新的POST请求
   - URL：`http://localhost:3000/api/appointments`
   - 在Headers标签页添加：
     - Key: `Authorization`
     - Value: `Bearer {复制的token}`
   - 请求体（JSON）：
     ```json
     {
       "scheduleId": "1",
       "captchaId": "{从响应中复制的captchaId}",
       "captchaCode": "{从验证码图片中读取的验证码}"
     }
     ```
   - 点击"Send"按钮
   - 记录预约ID和响应状态

**预期结果**：
- 预约成功
- 系统返回201状态码
- 响应消息："预约成功"
- 返回数据中包含完整的预约信息
- 数据库中新增一条有效的预约记录，状态为'pending'

#### 测试用例2: 短时间内两次预约测试（边界测试）
**Postman测试步骤**：
1. **用户登录**（如果token已过期，重新获取）
   - 使用与测试用例1相同的用户账号

2. **获取新验证码**：
   - 创建新的GET请求
   - URL：`http://localhost:3000/api/captcha/generate`
   - 点击"Send"按钮
   - 从响应中提取captchaId值，从验证码图片中读取captchaCode

3. **提交第二次预约请求**：
   - 创建新的POST请求
   - URL：`http://localhost:3000/api/appointments`
   - 添加Authorization头（使用相同token）
   - 请求体（JSON）：
     ```json
     {
       "scheduleId": "2",
       "captchaId": "{从响应中提取的新captchaId}",
       "captchaCode": "{从验证码图片中读取的新验证码}"
     }
     ```
   - 点击"Send"按钮
   - 记录预约ID和响应状态

**预期结果**：
- 第二次预约成功
- 系统返回201状态码
- 响应消息："预约成功"
- 数据库中新增第二条有效的预约记录，状态为'pending'
- 此时用户已达到5分钟内2次预约的上限

#### 测试用例3: 短时间内三次预约测试（触发限制）
**Postman测试步骤**：
1. **获取新验证码**：
   - 创建新的GET请求
   - URL：`http://localhost:3000/api/captcha/generate`
   - 点击"Send"按钮
   - 从响应中提取captchaId值和captchaCode

2. **提交第三次预约请求**：
   - 创建新的POST请求
   - URL：`http://localhost:3000/api/appointments`
   - 添加Authorization头（使用相同token）
   - 请求体（JSON）：
     ```json
     {
       "scheduleId": "3",
       "captchaId": "{新的captchaId}",
       "captchaCode": "{新的captchaCode}"
     }
     ```
   - 点击"Send"按钮
   - 记录响应状态和消息

3. **检查日志记录**：
   - 连接数据库
   - 执行查询：`SELECT * FROM tb_anti_hoarding_log WHERE log_type = 'user_hoarding_attempt' ORDER BY created_at DESC LIMIT 1`

**预期结果**：
- 第三次预约失败
- 系统返回429状态码
- 返回消息："您在短时间内预约过于频繁，请稍后再试"
- tb_anti_hoarding_log表中新增一条记录，log_type为'user_hoarding_attempt'
- 该记录包含正确的userId、ipAddress和请求时间
- 数据库中没有新增预约记录

#### 测试用例4: 取消预约后再次预约测试
**测试步骤**：
1. 完成测试用例2（用户已有2次有效预约）
2. 取消其中一次预约（PUT /appointments/:apptId/cancel）
3. 立即调用获取验证码接口，获取新的验证码
4. 尝试提交新的预约请求

**预期结果**：
- 取消预约成功
- 新的预约请求成功处理
- 系统返回201状态码
- 说明：因为取消后用户有效预约数变为1，所以可以再次预约

#### 测试用例5: 超过时间窗口后的预约测试
**测试步骤**：
1. 完成测试用例3，触发短时间预约限制
2. 等待5分钟10秒（确保超过5分钟的时间窗口）
3. 调用获取验证码接口，获取新的验证码
4. 提交新的预约请求

**预期结果**：
- 预约成功
- 系统返回201状态码
- 响应消息："预约成功"
- 说明：时间窗口过期后，用户的预约计数重置，允许再次预约

#### 测试用例6: 不同时间窗口的预约测试
**测试步骤**：
1. 用户登录系统
2. 提交第一次预约请求（时间T1）
3. 等待4分30秒
4. 提交第二次预约请求（时间T2）
5. 等待30秒（此时距离T1已超过5分钟）
6. 提交第三次预约请求（时间T3）

**预期结果**：
- 所有三次预约均成功
- 系统返回201状态码
- 说明：第三次预约时，第一次预约已超出5分钟时间窗口，不计入限制计数

### 4.2 IP限流测试

基于代码中实现的逻辑：系统使用Redis实现IP限流，针对不同场景设置了不同的限流规则：
- 登录尝试：1分钟内最多5次失败尝试
- 预约请求：1分钟内最多10次请求
- 验证码请求：1分钟内最多10次请求
当IP触发限流后，系统会记录到AntiHoardingLog表中，并返回429状态码。

#### 测试用例7: 预约接口IP限流测试
**测试步骤（使用Postman）**：
1. 确保测试环境中Redis服务正常运行
2. 打开Postman，创建新的请求集合"IP限流测试"
3. 创建并配置用户登录请求：
   - 请求方法：POST
   - URL：`http://localhost:3000/api/users/login`
   - 请求体（JSON）：
     ```json
     {
       "phone": "13800138001",
       "password": "password123"
     }
     ```
   - 发送请求获取JWT token
4. 创建预约请求模板：
   - 请求方法：POST
   - URL：`http://localhost:3000/api/appointments`
   - 在Headers标签页添加：
     - Key: `Authorization`
     - Value: `Bearer {复制的token}`
5. 使用Postman的Runner功能批量发送预约请求：
   - 选择预约请求
   - 设置Iterations为11
   - 设置Delay为500ms
   - 在Pre-request Script中添加动态修改scheduleId的脚本：
     ```javascript
     pm.request.body.raw = JSON.stringify({
       "scheduleId": pm.info.iteration,
       "captchaId": "{previously obtained captchaId}",
       "captchaCode": "{之前从验证码图片中读取的验证码}"
     });
     ```
   - 点击"Run"开始测试
6. 记录每次请求的响应状态和消息
7. 打开Redis管理工具或命令行，查看对应IP的限流记录：
   - 执行命令：`GET ip:rate:limit:{your_ip_address}:appointments`
   - 执行命令：`TTL ip:rate:limit:{your_ip_address}:appointments`
8. 连接数据库，执行查询：`SELECT * FROM tb_anti_hoarding_log WHERE log_type = 'ip_rate_limit' ORDER BY created_at DESC LIMIT 1`

**预期结果**：
- 前10次请求成功处理（假设所有预约条件均满足），返回201状态码
- 第11次请求返回429状态码
- 返回消息："您的请求过于频繁，请稍后再试"
- Redis中记录了该IP的请求计数，值为10
- tb_anti_hoarding_log表中新增记录，log_type为'ip_rate_limit'
- 日志记录包含正确的ipAddress、userId（如有）和请求时间

#### 测试用例8: 验证码接口IP限流测试
**测试步骤（使用Postman）**：
1. 确保测试环境中Redis服务正常运行
2. 打开Postman，创建新的请求集合"验证码接口IP限流测试"
3. 创建验证码请求模板：
   - 请求方法：GET
   - URL：`http://localhost:3000/api/captcha/generate`
4. 使用Postman的Runner功能批量发送验证码请求：
   - 选择验证码请求
   - 设置Iterations为11
   - 设置Delay为500ms
   - 点击"Run"开始测试
5. 记录每次请求的响应状态和消息
6. 打开Redis管理工具或命令行，查看对应IP的限流记录：
   - 执行命令：`GET ip:rate:limit:{your_ip_address}:captcha`
   - 执行命令：`TTL ip:rate:limit:{your_ip_address}:captcha`
7. 连接数据库，执行查询：`SELECT * FROM tb_anti_hoarding_log WHERE log_type = 'ip_rate_limit' ORDER BY created_at DESC LIMIT 1`

**预期结果**：
- 前10次请求成功获取验证码，返回200状态码
- 第11次请求返回429状态码
- 返回消息："获取验证码过于频繁，请稍后再试"
- Redis中记录了该IP的验证码请求计数，值为10
- tb_anti_hoarding_log表中新增记录，log_type为'ip_rate_limit'

#### 测试用例9: 登录接口IP限流测试
**测试步骤（使用Postman）**：
1. 确保测试环境中Redis服务正常运行
2. 打开Postman，创建新的请求集合"登录接口IP限流测试"
3. 创建登录请求模板：
   - 请求方法：POST
   - URL：`http://localhost:3000/api/users/login`
   - 请求体（JSON）：
     ```json
     {
       "phone": "13800138001",
       "password": "wrongpassword123"
     }
     ```
4. 使用Postman的Runner功能批量发送错误登录请求：
   - 选择登录请求
   - 设置Iterations为6
   - 设置Delay为500ms
   - 点击"Run"开始测试
5. 记录每次请求的响应状态和消息
6. 打开Redis管理工具或命令行，查看对应IP的限流记录：
   - 执行命令：`GET ip:rate:limit:{your_ip_address}:login_failures`
   - 执行命令：`TTL ip:rate:limit:{your_ip_address}:login_failures`
7. 连接数据库，执行查询：`SELECT * FROM tb_anti_hoarding_log WHERE log_type = 'ip_rate_limit' ORDER BY created_at DESC LIMIT 1`

**预期结果**：
- 前5次请求返回401状态码，提示用户名或密码错误
- 第6次请求返回429状态码
- 返回消息："登录失败次数过多，请稍后再试"
- Redis中记录了该IP的登录失败次数，值为5
- tb_anti_hoarding_log表中新增记录，log_type为'ip_rate_limit'

#### 测试用例10: 多用户同IP检测测试
**测试步骤**：
1. 准备5个不同的用户账号
2. 使用同一IP地址
3. 在1分钟内依次使用不同账号进行预约操作
4. 记录每次预约的结果

**预期结果**：
- 如果1分钟内5个账号都成功预约，系统应正常处理
- 系统应检测到同一IP多用户操作模式
- tb_anti_hoarding_log表中应有相关日志记录，标记可疑行为

#### 测试用例11: IP限流时间窗口重置测试
**测试步骤**：
1. 完成测试用例7，触发预约接口的IP限流
2. 等待61秒（确保超过1分钟的限流时间窗口）
3. 再次发送预约请求

**预期结果**：
- 请求成功处理
- 系统返回201状态码
- Redis中的IP计数已重置为1
- 说明：时间窗口过期后，IP的限流计数重置，允许正常访问

#### 测试用例12: 跨不同接口的IP限流测试
**测试步骤**：
1. 使用同一IP地址
2. 发送5次预约请求
3. 发送5次验证码请求
4. 发送1次预约请求
5. 记录所有请求的响应状态

**预期结果**：
- 所有预约请求和验证码请求都应正常处理
- 每个接口有独立的限流计数器
- Redis中应存在多个独立的限流键值对
- 说明：不同接口的限流是独立计算的，不会互相影响

### 4.3 验证码验证机制测试

基于代码中实现的逻辑：系统使用captchaMiddleware中间件验证所有预约请求，通过captchaId和captchaCode两个参数进行验证。用户需要从API响应中获取captchaId，并从验证码图片中读取captchaCode。验证码应有有效期限制，且只能使用一次。验证失败会记录到防抢号日志中。

#### 测试用例13: 正确验证码验证测试
**测试步骤（使用Postman）**：
1. 打开Postman，创建新的请求集合"验证码验证测试"
2. 创建用户登录请求：
   - 请求方法：POST
   - 请求URL：`http://localhost:3000/api/users/login`
   - 请求体（JSON）：
     ```json
     {
       "phone": "13800138001",
       "password": "password123"
     }
     ```
   - 点击"Send"按钮
   - 从响应中复制JWT token（在响应体的`token`字段）
3. 创建获取验证码请求：
   - 请求方法：GET
   - 请求URL：`http://localhost:3000/api/captcha/generate`
   - 点击"Send"按钮
   - 从响应中复制captchaId和captchaCode
4. 创建预约请求：
   - 请求方法：POST
   - 请求URL：`http://localhost:3000/api/appointments`
   - 在Headers标签页添加：
     - Key: `Authorization`
     - Value: `Bearer {复制的token}`
   - 请求体（JSON）：
     ```json
     {
       "scheduleId": "1",
       "captchaId": "{从步骤3获取的captchaId}",
       "captchaCode": "{从步骤3的验证码图片中读取的验证码}"
     }
     ```
5. 发送预约请求
6. 检查响应结果

**预期结果**：
- 验证码验证通过
- 预约请求正常处理
- 系统返回201状态码
- 响应消息："预约成功"
- 预约记录成功创建
- 返回数据中包含完整的预约信息

#### 测试用例14: 错误验证码测试
**测试步骤（使用Postman）**：
1. 打开Postman，使用已登录获取的JWT token
2. 创建新的获取验证码请求：
   - 请求方法：GET
   - 请求URL：`http://localhost:3000/api/captcha/generate`
   - 点击"Send"按钮
   - 从响应中复制captchaId（只需要captchaId，不需要从图片中读取captchaCode）
3. 创建预约请求：
   - 请求方法：POST
   - 请求URL：`http://localhost:3000/api/appointments`
   - 在Headers标签页添加：
     - Key: `Authorization`
     - Value: `Bearer {复制的token}`
   - 请求体（JSON）：
     ```json
     {
       "scheduleId": "1",
       "captchaId": "{从步骤2获取的captchaId}",
       "captchaCode": "9999"  // 故意输入错误的验证码（非图片中读取的值）
     }
     ```
4. 发送预约请求
5. 记录响应状态和错误消息
6. 连接数据库，执行查询：`SELECT * FROM tb_anti_hoarding_log WHERE log_type = 'invalid_captcha' ORDER BY created_at DESC LIMIT 1`

**预期结果**：
- 验证码验证失败
- 系统返回400状态码
- 返回消息："验证码错误"
- tb_anti_hoarding_log表中新增记录，记录类型为'invalid_captcha'

#### 测试用例15: 过期验证码测试
**测试步骤（使用Postman）**：
1. 打开Postman，使用已登录获取的JWT token
2. 创建获取验证码请求：
   - 请求方法：GET
   - 请求URL：`http://localhost:3000/api/captcha/generate`
   - 点击"Send"按钮
   - 从响应中提取captchaId值，从验证码图片中读取正确的captchaCode
3. 等待验证码过期（通常为2-5分钟，根据系统配置）
4. 创建预约请求，使用过期的验证码：
   - 请求方法：POST
   - 请求URL：`http://localhost:3000/api/appointments`
   - 在Headers标签页添加：
     - Key: `Authorization`
     - Value: `Bearer {复制的token}`
   - 请求体（JSON）：
     ```json
     {
       "scheduleId": "1",
       "captchaId": "{已过期的captchaId}",
       "captchaCode": "{从验证码图片中读取的正确验证码}"
     }
     ```
5. 发送预约请求
6. 记录响应状态和错误消息

**预期结果**：
- 验证码验证失败
- 系统返回400状态码
- 返回消息："验证码已过期"
- 数据库中不会创建预约记录

#### 测试用例16: 验证码重复使用测试
**测试步骤（使用Postman）**：
1. 打开Postman，使用已登录获取的JWT token
2. 创建获取验证码请求：
   - 请求方法：GET
   - 请求URL：`http://localhost:3000/api/captcha/generate`
   - 点击"Send"按钮
   - 从响应中提取captchaId值，从验证码图片中读取正确的captchaCode
3. 创建第一个预约请求：
   - 请求方法：POST
   - 请求URL：`http://localhost:3000/api/appointments`
   - 在Headers标签页添加：
     - Key: `Authorization`
     - Value: `Bearer {复制的token}`
   - 请求体（JSON）：
     ```json
     {
       "scheduleId": "1",
       "captchaId": "{从步骤2获取的captchaId}",
       "captchaCode": "{从步骤2的验证码图片中读取的验证码}"
     }
     ```
4. 发送第一个预约请求，确保预约成功
5. 立即创建第二个预约请求，使用相同的captchaId和captchaCode：
   - 请求方法：POST
   - 请求URL：`http://localhost:3000/api/appointments`
   - 在Headers标签页添加：
     - Key: `Authorization`
     - Value: `Bearer {复制的token}`
   - 请求体（JSON）：
     ```json
     {
       "scheduleId": "2",  // 使用不同的scheduleId
       "captchaId": "{从步骤2获取的相同captchaId}",
       "captchaCode": "{从步骤2的验证码图片中读取的相同验证码}"
     }
     ```
6. 发送第二个预约请求
7. 记录第二次请求的响应状态和消息

**预期结果**：
- 第一次预约成功，返回201状态码
- 第二次请求的验证码验证失败
- 系统返回400状态码
- 返回消息："验证码已使用"
- 验证码应在首次使用后立即失效

#### 测试用例17: 绕过验证码测试
**测试步骤（使用Postman）**：
1. 打开Postman，使用已登录获取的JWT token
2. 创建不包含验证码参数的预约请求：
   - 请求方法：POST
   - 请求URL：`http://localhost:3000/api/appointments`
   - 在Headers标签页添加：
     - Key: `Authorization`
     - Value: `Bearer {复制的token}`
   - 请求体（JSON）：
     ```json
     {
       "scheduleId": "1"  // 故意不包含验证码参数
     }
     ```
3. 发送请求，记录响应
4. 连接数据库，执行查询：`SELECT * FROM tb_anti_hoarding_log WHERE log_type LIKE '%bypass%' OR log_type = 'invalid_captcha' ORDER BY created_at DESC LIMIT 1`

**预期结果**：
- 请求验证失败
- 系统返回400状态码
- 返回消息："验证码不能为空"
- tb_anti_hoarding_log表中应记录尝试绕过验证码的行为

#### 测试用例18: 无效captchaId测试
**测试步骤（使用Postman）**：
1. 打开Postman，使用已登录获取的JWT token
2. 创建预约请求，使用一个随机生成的、不存在的captchaId：
   - 请求方法：POST
   - 请求URL：`http://localhost:3000/api/appointments`
   - 在Headers标签页添加：
     - Key: `Authorization`
     - Value: `Bearer {复制的token}`
   - 请求体（JSON）：
     ```json
     {
       "scheduleId": "1",
       "captchaId": "fake-invalid-captcha-id-123456",  // 无效的captchaId
       "captchaCode": "1234"  // 任意输入的验证码（非图片中读取的值）
     }
     ```
3. 发送请求，记录响应状态和错误消息
4. 连接数据库，执行查询：`SELECT * FROM tb_anti_hoarding_log WHERE log_type = 'invalid_captcha' ORDER BY created_at DESC LIMIT 1`

**预期结果**：
- 验证码验证失败
- 系统返回400状态码
- 返回消息："验证码不存在"
- tb_anti_hoarding_log表中新增记录，记录类型为'invalid_captcha'

### 4.4 并发预约安全性测试

基于代码中实现的逻辑：系统在预约创建时会检查时间段是否已被预约，并通过数据库事务确保数据一致性。针对并发场景，需要测试系统是否能正确处理同时预约同一时间段的请求，避免超卖或数据不一致问题。

#### 测试用例19: 多用户同时预约同一时间段测试（防止超卖）
**测试步骤（使用Postman）**：
1. 打开Postman，创建新的请求集合"并发预约测试"
2. 准备5个不同用户账号的登录信息
3. 创建5个用户登录请求，分别获取JWT token：
   - 请求方法：POST
   - URL：`http://localhost:3000/api/users/login`
   - 请求体（JSON）：
     ```json
     {
       "phone": "13800138001", // 第一个用户
       "password": "password123"
     }
     ```
   - 重复创建其他四个用户的登录请求
4. 为每个用户创建预约请求，都预约同一个时间段：
   - 请求方法：POST
   - URL：`http://localhost:3000/api/appointments`
   - 请求头：
     * Content-Type: application/json
     * Authorization: Bearer {各自的token}
   - 请求体（JSON）：
     ```json
     {
       "scheduleId": "same_schedule_id",
       "captchaId": "{各自的captchaId}",
       "captchaCode": "{从各自验证码图片中读取的验证码}"
     }
     ```
5. 使用Postman的Collection Runner或Newman命令行工具同时发送这5个请求：
   - 在Collection Runner中选择并发测试集合
   - 设置Number of Iterations为1
   - 点击"Run"执行并发测试
6. 记录所有请求的响应状态和消息
7. 连接数据库，执行查询确认预约结果：
   ```sql
   SELECT * FROM tb_appointment WHERE schedule_id = 'same_schedule_id';
   ```

**预期结果**：
- 只有1个用户预约成功（系统返回201状态码）
- 其他4个用户预约失败（系统返回409或400状态码）
- 失败原因："该时间段已被预约"或"没有可用号源"
- 数据库中只存在一条该时间段的预约记录
- tb_anti_hoarding_log表中应记录并发预约行为

#### 测试用例20: 同一用户并发预约测试（请求排队）
**测试步骤（使用Postman）**：
1. 打开Postman，创建新的请求集合"同一用户并发测试"
2. 用户登录获取JWT token
3. 创建3个预约请求，分别预约不同的可用时间段：
   - 请求方法：POST
   - URL：`http://localhost:3000/api/appointments`
   - 请求头：
     * Content-Type: application/json
     * Authorization: Bearer {token}
   - 请求体（JSON）：
     ```json
     {
       "scheduleId": "不同的scheduleId1", // 每个请求使用不同的scheduleId
       "captchaId": "{captchaId}",
       "captchaCode": "{从验证码图片中读取的验证码}"
     }
     ```
4. 使用Postman的Collection Runner同时发送这3个请求：
   - 设置Number of Iterations为1
   - 设置Delay为100ms
   - 点击"Run"执行测试
5. 记录所有请求的响应状态和处理顺序
6. 连接数据库，执行查询：
   ```sql
   SELECT * FROM tb_appointment WHERE user_id = '{用户ID}' ORDER BY created_at;
   ```

**预期结果**：
- 系统能正确处理所有请求
- 所有3个预约都应成功创建（假设都在限制范围内）
- 系统应按请求到达顺序依次处理，而不是同时处理
- 数据库中应存在3条不同时间段的预约记录
- 记录的创建时间应呈现微小差异，表明请求是按顺序处理的

#### 测试用例21: 并发取消预约测试
**测试步骤（使用Postman）**：
1. 打开Postman，创建新的请求集合"并发取消测试"
2. 用户登录并成功预约一个号源，获取appointmentId
3. 创建2个取消预约请求，使用相同的token和appointmentId：
   - 请求方法：PUT
   - URL：`http://localhost:3000/api/appointments/{appointmentId}/cancel`
   - 请求头：
     * Content-Type: application/json
     * Authorization: Bearer {token}
4. 使用Postman的Collection Runner同时发送这2个取消请求：
   - 设置Number of Iterations为2
   - 设置Delay为100ms
   - 点击"Run"执行测试
5. 记录两个请求的响应状态
6. 连接数据库，执行查询：
   ```sql
   SELECT * FROM tb_appointment WHERE id = '{appointmentId}';
   ```

**预期结果**：
- 只有1个取消请求成功（系统返回200状态码）
- 另1个取消请求失败（系统返回404状态码）
- 失败原因："预约不存在或已取消"
- 数据库中该预约记录状态应更新为'cancelled'
- 系统应正确处理重复取消操作，不会出现异常

#### 测试用例22: 预约-取消-预约并发测试
**测试步骤（使用Postman）**：
1. 打开Postman，创建新的请求集合"预约-取消-预约测试"
2. 准备2个不同用户账号（用户A和用户B），分别获取JWT token
3. 创建3个请求：
   - 请求1：用户A预约请求
   - 请求2：用户A取消预约请求
   - 请求3：用户B预约请求
4. 使用Postman的Collection Runner快速连续执行这3个请求：
   - 设置Number of Iterations为1
   - 设置Delay为100ms
   - 确保请求按顺序执行
5. 记录所有请求的响应状态
6. 连接数据库，执行查询：
   ```sql
   SELECT * FROM tb_appointment WHERE schedule_id = 'target_schedule_id';
   ```

**预期结果**：
- 系统应正确处理这种时序敏感的并发操作
- 结果1：用户A取消成功，用户B预约成功
- 结果2：用户A取消失败，用户B预约失败（如果取消操作失败）
- 数据库应保持一致性状态，不会出现数据异常
- 系统不应创建重复预约或丢失预约记录

#### 测试用例23: 高并发下的系统稳定性测试
**测试步骤（使用Postman + Newman）**：
1. 导出之前创建的预约请求集合为JSON文件
2. 安装Newman（Postman的命令行工具）：
   ```bash
   npm install -g newman
   ```
3. 准备100个测试用户账号的数据文件（CSV格式），包含phone、password等信息
4. 使用Newman运行高并发测试：
   ```bash
   newman run 预约测试集合.json -d 用户数据.csv -n 5 --concurrency 20
   ```
   - `-d` 指定数据文件
   - `-n` 指定迭代次数
   - `--concurrency` 设置并发数
5. 监控系统资源使用情况（CPU、内存、数据库连接数）
6. 测试结束后，分析Newman生成的报告，记录响应时间和成功率
7. 连接数据库，验证数据一致性

**预期结果**：
- 系统稳定运行，不出现崩溃
- 符合预约条件的请求成功处理
- 超出限制的请求被正确拒绝（限流、频率限制等）
- 数据库连接数在配置的最大连接数范围内
- 平均响应时间不超过500ms
- 成功率应达到99%以上（不考虑因业务规则拒绝的请求）

#### 测试用例24: 数据库事务隔离测试
**测试步骤（使用Postman + 数据库工具）**：
1. 先检查数据库当前的隔离级别：
   ```sql
   SELECT @@global.tx_isolation, @@tx_isolation;
   ```
2. 打开Postman，创建新的请求集合"事务隔离测试"
3. 准备两个测试用户账号，分别获取JWT token
4. 创建用户1的预约请求（用于开启长事务）：
   - 请求方法：POST
   - URL：`http://localhost:3000/api/appointments`
   - 请求头：
     * Content-Type: application/json
     * Authorization: Bearer {用户1的token}
   - 请求体（JSON）：
     ```json
     {
       "scheduleId": "target_schedule_id",
       "captchaId": "{captchaId}",
       "captchaCode": "{从验证码图片中读取的验证码}",
       "testLongTransaction": true // 假设的测试参数，用于让事务暂停
     }
     ```
5. 发送用户1的请求，并在数据库工具中确认事务已开启但未提交
6. 立即发送用户2的预约请求，预约同一个时间段：
   - 请求方法：POST
   - URL：`http://localhost:3000/api/appointments`
   - 请求头：
     * Content-Type: application/json
     * Authorization: Bearer {用户2的token}
   - 请求体（JSON）：
     ```json
     {
       "scheduleId": "target_schedule_id",
       "captchaId": "{captchaId}",
       "captchaCode": "{从验证码图片中读取的验证码}"
     }
     ```
7. 观察用户2的请求状态（应被阻塞）
8. 在数据库工具中提交用户1的事务
9. 继续观察用户2的请求结果

**预期结果**：
- 用户2的请求应被阻塞，直到用户1的事务完成
- 若用户1事务提交成功，用户2的请求应失败
- 若用户1事务回滚，用户2的请求应成功（如果号源仍可用）
- 系统应正确应用数据库事务隔离级别，避免脏读和幻读
- 数据库中最终应只有一条有效的预约记录

### 4.5 黑名单机制测试

基于代码中实现的逻辑：系统通过AntiHoardingLog表记录可疑行为，并应有机制将频繁触发规则的用户或IP自动添加到黑名单中。黑名单应有过期时间设置，超过时间后自动解除限制。

#### 测试用例25: 自动添加用户黑名单测试
**测试步骤（使用Postman）**：
1. 打开Postman，创建新的请求集合"黑名单测试"
2. 创建测试用户的登录请求：
    - 请求方法：POST
    - URL：`http://localhost:3000/api/users/login`
    - 请求体（JSON）：
      ```json
      {
        "username": "testuser",
        "password": "password123"
      }
      ```
    - 发送请求获取JWT token
3. 故意触发多次防抢号规则：
   - 创建获取验证码请求：GET `http://localhost:3000/api/captcha/generate`
   - 从响应中提取captchaId值
   - 创建错误验证码的预约请求：
     ```json
     {
       "scheduleId": "1",
       "captchaId": "{从验证码接口获取的captchaId}",
       "captchaCode": "9999"  // 故意输入错误的验证码（非图片中读取的值）
     }
     ```
   - 使用Postman Runner连续发送10次
4. 继续尝试正常预约操作
5. 记录系统响应
6. 连接数据库，执行查询：
   ```sql
   SELECT * FROM tb_anti_hoarding_log WHERE log_type LIKE '%blacklist%' ORDER BY created_at DESC LIMIT 1;
   ```

**预期结果**：
- 当用户违规次数达到阈值时，系统自动将用户加入黑名单
- 后续预约请求被拒绝，返回403状态码
- 返回消息："您的账号已被限制使用，请联系客服"
- tb_anti_hoarding_log表中应有黑名单相关记录
- 数据库中应存在用户黑名单记录

#### 测试用例26: 自动添加IP黑名单测试
**测试步骤（使用Postman）**：
1. 打开Postman，创建新的请求集合"IP黑名单测试"
2. 确保测试环境中Redis服务正常运行
3. 使用同一IP地址，创建高频请求：
   - 创建预约请求模板
   - 使用Postman Runner连续发送15次预约请求（确保超过IP限流阈值）
4. 继续尝试预约操作
5. 记录系统响应
6. 连接数据库，执行查询：
   ```sql
   SELECT * FROM tb_anti_hoarding_log WHERE log_type LIKE '%blacklist%' AND ip_address = '{your_ip_address}' ORDER BY created_at DESC LIMIT 1;
   ```

**预期结果**：
- IP地址因多次违规行为被自动添加到黑名单
- 该IP地址的所有请求均被拒绝
- 系统返回403状态码
- 返回消息："您的IP地址已被限制访问，请稍后再试"
- tb_anti_hoarding_log表中应有IP黑名单相关记录

#### 测试用例27: 手动添加/移除黑名单测试
**测试步骤（使用Postman）**：
1. 打开Postman，创建新的请求集合"手动黑名单管理测试"
2. 管理员账号登录，获取JWT token：
    - 请求方法：POST
    - URL：`http://localhost:3000/api/users/login`
    - 请求体（JSON）：
      ```json
      {
        "username": "admin123",
        "password": "admin456"
      }
      ```
3. 手动将测试用户加入黑名单：
   - 请求方法：POST
   - 请求URL：`http://localhost:3000/api/admin/blacklist`
   - 请求头：
     * Key: `Authorization`
     * Value: `Bearer {admin_token}`
   - 请求体（JSON）：
     ```json
     {
       "userId": "test_user_id",
       "reason": "测试手动拉黑",
       "expireTime": "2024-12-31T23:59:59"
     }
     ```
4. 发送请求，记录响应
5. 使用被拉黑的用户尝试预约，验证是否被拒绝
6. 手动将用户从黑名单移除：
   - 请求方法：DELETE
   - 请求URL：`http://localhost:3000/api/admin/blacklist/{userId}`
   - 请求头添加Authorization
7. 发送请求，记录响应
8. 再次使用该用户尝试预约，验证是否恢复正常

**预期结果**：
- 手动添加黑名单后，用户请求被拒绝，返回403状态码
- 手动移除黑名单后，用户请求恢复正常，返回201状态码
- 系统应正确处理黑名单的添加和移除操作
- 管理接口操作应有审计日志记录

#### 测试用例28: 黑名单过期自动解除测试
**测试步骤（使用Postman）**：
1. 打开Postman，创建新的请求集合"黑名单过期测试"
2. 使用管理员账号手动添加测试用户到黑名单，设置较短的过期时间（如5分钟）
3. 立即使用该用户尝试预约，验证被拒绝
4. 等待5分钟（黑名单过期时间）
5. 再次使用该用户尝试预约
6. 记录系统响应
7. 连接数据库，检查黑名单记录状态

**预期结果**：
- 黑名单自动过期后，用户限制被解除
- 预约请求恢复正常处理，系统返回201状态码
- 数据库中黑名单记录状态应更新为已过期或被删除

#### 测试用例29: 黑名单用户的其他操作测试
**测试步骤（使用Postman）**：
1. 打开Postman，创建新的请求集合"黑名单用户操作测试"
2. 将测试用户添加到黑名单
3. 尝试使用该用户进行以下操作：
   - 登录操作：POST `http://localhost:3000/api/users/login`
   - 查看个人信息：GET `http://localhost:3000/api/users/profile`
   - 修改密码：PUT `http://localhost:3000/api/users/password`
   - 查看预约列表：GET `http://localhost:3000/api/appointments`
   - 取消已有预约：PUT `http://localhost:3000/api/appointments/{apptId}/cancel`
4. 为每个操作创建对应的请求，使用被拉黑用户的token
5. 发送每个请求，记录响应结果

**预期结果**：
- 系统应对黑名单用户采取分级限制：
  - 核心操作（预约）应被完全禁止，返回403状态码
  - 查询操作（查看信息）可能允许执行，返回200状态码
  - 账户管理操作（修改密码）可能允许执行，返回200状态码
- 系统应根据操作类型返回不同的限制信息

#### 测试用例30: 黑名单检测绕过测试
**测试步骤（使用Postman）**：
1. 打开Postman，创建新的请求集合"黑名单绕过测试"
2. 将测试用户加入黑名单
3. 尝试通过以下方式绕过黑名单：
   - 使用VPN更换IP但保持同一账号：
     * 修改请求头中的X-Forwarded-For为新IP
     * 使用被拉黑用户的token发送预约请求
   - 使用同一IP但更换不同账号：
     * 使用未被拉黑的新账号登录获取token
     * 使用相同IP发送预约请求
   - 伪造请求头信息：
     * 修改User-Agent等请求头信息
     * 使用被拉黑用户的token发送预约请求
4. 发送每个测试请求，记录响应结果
5. 连接数据库，查询防抢号日志：
   ```sql
   SELECT * FROM tb_anti_hoarding_log WHERE log_type LIKE '%bypass%' ORDER BY created_at DESC LIMIT 5;
   ```

**预期结果**：
- 系统应能通过多维度检测发现绕过行为：
  - 即使IP改变，黑名单用户账号仍应被拒绝，返回403状态码
  - 同一IP的多个新账号可能触发额外的审查机制
  - 伪造请求头不应影响黑名单检测结果
- tb_anti_hoarding_log表中应记录尝试绕过黑名单的行为

### 4.6 防抢号日志记录功能测试

基于代码中实现的逻辑：系统使用AntiHoardingLog模型记录所有可疑行为，包括用户频繁预约、IP限流、无效验证码、黑名单操作等。日志系统是防抢号机制的重要组成部分，用于审计、分析和改进防抢号策略。

#### 测试用例31: 日志记录完整性测试
**测试步骤（使用Postman）**：
1. 打开Postman，创建新的请求集合"防抢号日志测试"
2. 执行各种防抢号相关操作：
   - 正常预约请求：
     ```json
     {
       "scheduleId": "1",
       "captchaId": "valid-captcha-id",
       "captchaCode": "1234"
     }
     ```
   - 验证码错误请求：
     ```json
     {
       "scheduleId": "1",
       "captchaId": "valid-captcha-id",
       "captchaCode": "9999"
     }
     ```
   - 频繁预约触发限流：使用Postman Runner连续发送10次预约请求
   - 触发黑名单：继续发送违规请求，直到用户被加入黑名单
3. 连接数据库，执行查询：
   ```sql
   SELECT * FROM tb_anti_hoarding_log ORDER BY created_at DESC LIMIT 20;
   ```
4. 验证每条日志记录的字段完整性
5. 检查日志的时间戳与操作时间的一致性

**预期结果**：
- 所有防抢号相关操作都应有对应的日志记录
- 每条日志记录包含完整信息：logId、userId、ipAddress、logType、requestParams、createdAt等
- 日志记录的时间戳准确反映事件发生时间（误差在1秒内）
- 日志类型与触发的规则类型一致

#### 测试用例32: 日志查询功能测试
**测试步骤（使用Postman）**：
1. 打开Postman，创建新的请求集合"日志查询测试"
2. 管理员账号登录，获取JWT token：
   ```json
   {
     "phone": "admin123",
     "password": "admin456"
   }
   ```
3. 调用防抢号日志查询接口，使用不同查询条件：
   - 按用户ID查询：
     * 请求方法：GET
     * URL：`http://localhost:3000/api/admin/anti-hoarding-logs?userId=test_user_id&page=1&pageSize=10`
     * 请求头：Authorization: Bearer {admin_token}
   - 按IP地址查询：
     * URL：`http://localhost:3000/api/admin/anti-hoarding-logs?ip=192.168.1.100&page=1&pageSize=10`
   - 按日志类型查询：
     * URL：`http://localhost:3000/api/admin/anti-hoarding-logs?logType=invalid_captcha&page=1&pageSize=10`
   - 按时间范围查询：
     * URL：`http://localhost:3000/api/admin/anti-hoarding-logs?startTime=2024-12-25T00:00:00&endTime=2024-12-25T23:59:59&page=1&pageSize=10`
   - 组合条件查询：
     * URL：`http://localhost:3000/api/admin/anti-hoarding-logs?userId=test_user_id&logType=failed&page=1&pageSize=10`
4. 对每个查询请求，验证返回结果的准确性
5. 检查分页功能，尝试不同的page和pageSize参数

**预期结果**：
- 所有查询请求应返回200状态码
- 返回的日志记录应与查询条件完全匹配
- 分页功能应正常工作，每页显示指定数量的记录
- 返回数据应包含总记录数和总页数信息
- 结果应按时间倒序排列
- 查询响应时间应在可接受范围内（<1秒）

#### 测试用例33: 日志统计分析功能测试
**测试步骤（使用Postman）**：
1. 打开Postman，创建新的请求集合"日志统计测试"
2. 使用管理员账号登录，获取JWT token
3. 调用防抢号日志统计接口，尝试不同维度的统计：
   - 各类型日志数量统计：
     * 请求方法：GET
     * URL：`http://localhost:3000/api/admin/anti-hoarding-logs/stats?dimension=logType`
     * 请求头：Authorization: Bearer {admin_token}
   - 高频违规用户TOP10：
     * URL：`http://localhost:3000/api/admin/anti-hoarding-logs/stats?dimension=topUsers&limit=10`
   - 高频违规IP TOP10：
     * URL：`http://localhost:3000/api/admin/anti-hoarding-logs/stats?dimension=topIPs&limit=10`
   - 时间段分布统计：
     * URL：`http://localhost:3000/api/admin/anti-hoarding-logs/stats?dimension=timeDistribution&startDate=2024-12-01&endDate=2024-12-31`
4. 对每个统计请求，验证返回结果的准确性
5. 连接数据库执行手动统计，与API返回结果进行对比

**预期结果**：
- 所有统计请求应返回200状态码
- 统计数据与实际日志记录一致
- 数据聚合计算准确
- 图表展示功能正常（如果有）
- 统计结果可用于安全策略优化

#### 测试用例34: 日志数据安全测试
**测试步骤（使用Postman）**：
1. 打开Postman，创建新的请求集合"日志安全测试"
2. 访问控制测试：
   - 使用普通用户账号登录获取token
   - 尝试调用日志查询接口：
     * URL：`http://localhost:3000/api/admin/anti-hoarding-logs`
     * 请求头：Authorization: Bearer {user_token}
3. SQL注入测试：
   - 使用管理员token
   - 尝试注入SQL语句：
     * URL：`http://localhost:3000/api/admin/anti-hoarding-logs?userId=1%20OR%201=1`
4. 敏感信息检查：
   - 使用管理员账号调用日志查询接口
   - 检查返回的数据中是否包含敏感信息（如密码、完整手机号等）
5. 日志导出测试（如果系统支持）：
   - 调用日志导出接口：
     * URL：`http://localhost:3000/api/admin/anti-hoarding-logs/export?format=csv`
     * 验证导出文件的生成和权限控制

**预期结果**：
- 未授权用户无法访问防抢号日志，返回403状态码
- 敏感信息应进行脱敏处理（如手机号中间4位显示为*）
- SQL注入尝试应返回400或500错误，系统不应执行注入的SQL
- 日志导出功能需要管理员权限
- 所有日志访问操作应有审计记录

## 5. 测试执行计划

### 5.1 环境配置

**测试环境准备**：
- 数据库：确保MySQL数据库已安装并创建必要的表结构（tb_anti_hoarding_log, tb_blacklist等）
- Redis：确保Redis服务已安装并运行正常，用于缓存限流数据和验证码信息
- 后端服务：确保后端服务已启动并连接到数据库和Redis
- Postman：安装最新版本的Postman工具（v10.0+）

**Postman环境配置**：
1. 打开Postman，点击左上角"New" -> "Environment"
2. 创建"防抢号测试环境"，添加以下环境变量：
   - baseUrl: http://localhost:3000/api
   - adminToken: {{adminToken}}
   - userToken: {{userToken}}
   - testUserId: test_user_123
   - testScheduleId: 1
3. 保存环境配置

**测试数据准备**：
- 创建测试用户账号（普通用户和管理员账号）
- 准备测试的医生排班数据
- 使用Postman Pre-request Scripts自动设置测试数据

### 5.2 测试执行步骤

1. **环境验证**：
   - 使用Postman发送健康检查请求：
     ```
     GET {{baseUrl}}/health
     ```
   - 验证数据库连接状态：
     ```sql
     SELECT 1 FROM tb_anti_hoarding_log LIMIT 1;
     ```
   - 验证Redis服务状态：
     ```
     redis-cli ping
     ```

2. **Postman集合导入与执行**：
   - 将测试用例导出为Postman Collection JSON文件
   - 导入到Postman中
   - 配置集合使用"防抢号测试环境"

3. **按模块执行Postman测试**：
   - 执行用户短时间频繁预约限制测试：
     * 打开"用户预约限制测试"文件夹
     * 运行测试用例1-5
     * 使用Postman Runner批量执行
   - 执行IP限流测试：
     * 打开"IP限流测试"文件夹
     * 配置Runner的迭代次数和延迟时间
     * 执行测试用例6-12
   - 执行验证码验证机制测试：
     * 打开"验证码测试"文件夹
     * 执行测试用例13-18
   - 执行并发预约安全性测试：
     * 配置Newman命令行工具
     * 执行：`newman run "并发测试.json" -e "防抢号测试环境.json" --iteration-count 20 --delay-request 100`
   - 执行黑名单机制测试：
     * 打开"黑名单测试"文件夹
     * 执行测试用例25-30
   - 执行防抢号日志记录功能测试：
     * 打开"日志测试"文件夹
     * 执行测试用例31-34

4. **Postman测试数据验证**：
   - 每个测试用例后添加Tests脚本验证响应：
     ```javascript
     pm.test("响应状态码应为403", function () {
       pm.response.to.have.status(403);
     });
     
     pm.test("响应应包含正确的错误信息", function () {
       var jsonData = pm.response.json();
       pm.expect(jsonData.message).to.include("限制");
     });
     ```
   - 使用Postman的Database Connector插件连接数据库验证测试结果

5. **回归测试**：
   - 使用Postman的Collection Runner运行整个测试集合
   - 生成HTML报告：`newman run "防抢号测试集合.json" -e "防抢号测试环境.json" --reporters cli,junit,htmlextra --reporter-htmlextra-export report.html`

### 5.3 测试结果记录与评估

**Postman测试结果记录**：
- 使用Postman的测试结果导出功能
- 生成HTML测试报告，包含详细的请求/响应信息
- 记录每个测试用例的执行状态（通过/失败/阻塞）
- 对失败的测试用例记录详细的错误信息和复现步骤

**测试结果评估**：
- 分析Postman测试报告中的通过率
- 评估防抢号机制的有效性
- 总结发现的问题和改进建议
- 使用Postman Monitor功能进行定期测试（可选）

## 6. 风险评估与缓解措施

### 6.1 功能风险

| 风险点 | 影响程度 | 可能性 | 缓解措施 |
|--------|----------|--------|----------|
| 限流阈值设置不合理 | 中 | 高 | 使用Postman进行负载测试，模拟不同用户量下的请求频率，根据结果动态调整阈值 |
| 验证码复杂度不足 | 中 | 中 | 增强验证码生成算法，使用Postman进行验证码识别难度测试 |
| 黑名单误判 | 高 | 低 | 使用Postman设计边界测试用例，优化黑名单触发条件，增加白名单机制 |
| 并发控制失效 | 高 | 低 | 使用Postman + Newman模拟高并发场景，加强数据库事务隔离级别，增加分布式锁 |
| 日志记录性能影响 | 低 | 中 | 优化日志记录机制，使用Postman测试异步写入日志的性能 |

### 6.2 性能风险

| 风险点 | 影响程度 | 可能性 | 缓解措施 |
|--------|----------|--------|----------|
| Redis缓存失效 | 高 | 低 | 使用Postman进行故障注入测试，模拟Redis缓存失效场景下的系统表现 |
| 高并发下响应延迟 | 高 | 中 | 使用Postman + Newman进行压力测试，优化SQL查询，增加缓存层 |
| 日志量过大 | 中 | 高 | 使用Postman测试日志写入性能，实现日志轮转和归档机制 |

### 6.3 安全风险

| 风险点 | 影响程度 | 可能性 | 缓解措施 |
|--------|----------|--------|----------|
| 验证码绕过 | 高 | 中 | 使用Postman设计绕过测试用例，增加验证码难度，结合行为分析 |
| IP伪造 | 高 | 高 | 使用Postman修改请求头模拟IP伪造，实现代理IP检测 |
| SQL注入 | 高 | 低 | 使用Postman进行SQL注入测试，使用参数化查询，加强输入验证 |
| 敏感信息泄露 | 高 | 低 | 使用Postman检查API响应中的敏感信息，对敏感信息进行加密存储和传输 |

## 7. 结论与建议

### 7.1 测试结论

基于Postman详细测试用例的执行，我们将全面验证系统的防抢号机制。通过使用Postman工具进行功能测试、边界测试、安全性测试和性能测试，我们能够确保系统在各种情况下都能有效防止恶意抢号行为，同时不影响正常用户的预约体验。

Postman测试方案的优势在于：
- 提供详细的步骤指导，便于测试人员执行
- 支持自动化测试，提高测试效率和准确性
- 可以生成详细的测试报告，便于问题追踪和管理
- 支持团队协作，便于测试用例的共享和维护

### 7.2 后续优化建议

1. **Postman自动化测试集成**：
   - 将Postman测试集集成到CI/CD流程中
   - 配置定期执行的Postman Monitor进行持续监控

2. **持续监控与调整**：
   - 上线后使用Postman进行定期的功能验证
   - 根据实际运营数据调整限流阈值和黑名单规则

3. **智能风控升级**：
   - 引入机器学习模型识别异常行为
   - 使用Postman测试智能风控接口

4. **安全性增强**：
   - 定期使用Postman进行安全测试
   - 及时修复发现的安全漏洞

5. **测试数据管理**：
   - 使用Postman环境变量和数据文件管理测试数据
   - 实现测试数据的自动准备和清理

---

**测试方案编写日期**：2024年
**测试负责人**：[测试负责人姓名]
**审批人**：[审批人姓名]
