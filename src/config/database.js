const { Sequelize } = require('sequelize');
// dotenv已在server.js中全局配置

// 创建Sequelize实例
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'mysql',
    dialectOptions: {
      // 设置事务隔离级别为REPEATABLE READ，平衡并发性能和数据一致性
      isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.REPEATABLE_READ
    },
    pool: {
      max: 100, // 大幅增加数据库连接池大小以支持更高并发
      min: 10,  // 增加最小连接数
      acquire: 60000, // 增加获取连接的超时时间
      idle: 10000
    },
    logging: false, // 禁用SQL查询日志输出
    define: {
      // 确保使用正确的字段命名策略
      underscored: true,
      freezeTableName: true
    }
  }
);

// 测试连接
const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log('MySQL连接成功');
    // 修改为不自动修改表结构，避免重复创建索引导致超出MySQL的64个索引限制
    await sequelize.sync({}); 
    console.log('数据库连接成功，表结构已保留现状');
  } catch (error) {
    console.error('MySQL连接失败:', error);
    process.exit(1);
  }
};

module.exports = { sequelize, connectDB };