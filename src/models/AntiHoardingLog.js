const { DataTypes } = require('sequelize');

// 定义防抢号日志模型 - 对应 tb_anti_hoarding_log 表
let AntiHoardingLog;

const AntiHoardingLogModel = {
  // 初始化模型
  initiate: (sequelize) => {
    AntiHoardingLog = sequelize.define('AntiHoardingLog', {
      logId: {
        field: 'log_id',
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        comment: '日志ID'
      },
      userId: {
        field: 'user_id',
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: '关联 tb_user 的ID（如适用），外键'
      },
      ipAddress: {
        field: 'ip_address',
        type: DataTypes.STRING(45),
        allowNull: false,
        comment: '触发策略的IP地址'
      },
      requestTime: {
        field: 'request_time',
        type: DataTypes.DATE,
        allowNull: false,
        comment: '请求时间'
      },
      logType: {
        field: 'log_type',
        // **关键修改：将 ENUM 列表替换/增加为您的实际值**
        type: DataTypes.ENUM('high_frequency', 'same_ip_multi_user', 'illegal_operation'),
        allowNull: false,
        // 相应更新注释
        comment: '日志类型: high_frequency(高频限制), same_ip_multi_user(同IP多用户), illegal_operation(非法操作)'
      }
    }, {
      tableName: 'tb_anti_hoarding_log',
      timestamps: false
    });
    
    return AntiHoardingLog;
  },
  // 获取AntiHoardingLog模型实例
  getModel: () => AntiHoardingLog
};


module.exports = AntiHoardingLogModel;