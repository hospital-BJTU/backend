// 在所有模块加载之前配置dotenv
process.env.DOTENV_SILENT = '1';
const dotenv = require('dotenv');
dotenv.config({ debug: false, silent: true });

const express = require('express');
const corsPackage = require('cors');

// 根据环境变量或默认值选择CORS配置
const NODE_ENV = process.env.NODE_ENV || 'development';
// 尝试加载cors-dev，如果不存在则使用cors
let corsOptions;
try {
  corsOptions = require('./config/cors-dev');
  console.log('使用cors-dev配置');
} catch (error) {
  corsOptions = require('./config/cors');
  console.log('使用cors配置');
}
const { connectDB } = require('./config/database');
const { connectRedis } = require('./config/redis');

// 从环境变量获取端口
const PORT = process.env.PORT;

// 导入路由
const userRoutes = require('./routes/userRoutes');
const userAdminRoutes = require('./routes/userAdminRoutes');
const doctorRoutes = require('./routes/doctorRoutes');
const captchaRoutes = require('./routes/captchaRoutes');
// 替换原有的appointmentRoutes，使用新的分离路由
const userAppointmentRoutes = require('./routes/userAppointmentRoutes');
const doctorAppointmentRoutes = require('./routes/doctorAppointmentRoutes');
const adminRoutes = require('./routes/adminRoutes');
const miniprogramRoutes = require('./routes/miniprogramRoutes');

const app = express();

// 配置中间件
app.use(corsPackage(corsOptions));
app.use(express.json());

// 连接数据库在启动服务器时进行
// 注册路由
app.use('/api/users', userRoutes);
app.use('/api/admin/users', userAdminRoutes);
app.use('/api/admin/doctors', doctorRoutes);
app.use('/api/captcha', captchaRoutes);
// 注册分离后的预约路由
app.use('/api/user', userAppointmentRoutes);     // 患者端预约路由
app.use('/api/doctor', doctorAppointmentRoutes); // 医生端预约路由
app.use('/api/admin', adminRoutes);             // 管理员路由
app.use('/api/miniprogram', miniprogramRoutes); // 小程序路由

app.get('/', (req, res) => {
  res.json({
    code: 200,
    message: '医院管理系统后端API',
    data: {
      name: '北交大校医院挂号系统',
      version: '1.0.0'
    }
  });
});

// 全局错误处理中间件 - 移到这里
app.use((err, req, res, next) => {
  // 处理CORS错误
  if (err.message === '不允许的跨域请求') {
    return res.status(403).json({
      success: false,
      message: 'CORS错误：不允许的跨域请求',
      error: err.message
    });
  }
  
  // 处理其他错误
  res.status(500).json({
    success: false,
    message: '服务器内部错误',
    error: err.message
  });
});

// 连接数据库和Redis并启动服务器 - 最后调用
const startServer = async () => {
  try {
    await connectDB();
    await connectRedis(); // 连接Redis
    app.listen(PORT, () => {
      console.log(`服务器运行在 http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('启动服务器失败:', error);
  }
};

startServer();