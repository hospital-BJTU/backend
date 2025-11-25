const { DataTypes } = require('sequelize');

// 定义审核日志模型 - 对应 tb_audit_log 表
let AuditLog;

const AuditLogModel = {
  // 初始化模型
  initiate: (sequelize) => {
    AuditLog = sequelize.define('AuditLog', {
      logId: {
        field: 'log_id',
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        comment: '日志ID'
      },
      scheduleId: {
        field: 'schedule_id',
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: '关联 tb_schedule 的ID，外键'
      },
      adminId: {
        field: 'admin_id',
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: '关联 tb_user 的ID（管理员），外键'
      },
      auditResult: {
        field: 'audit_result',
        type: DataTypes.ENUM('approved', 'rejected'),
        allowNull: false,
        comment: '审核结果: approved(通过), rejected(拒绝)'
      },
      reason: {
        field: 'reason',
        type: DataTypes.STRING(512),
        comment: '审核原因'
      },
      auditTime: {
        field: 'audit_time',
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        comment: '审核时间'
      }
    }, {
      tableName: 'tb_audit_log',
      timestamps: false,
      constraints: false
    });

    return AuditLog;
  },
  // 获取AuditLog模型实例
  getModel: () => AuditLog
};


module.exports = AuditLogModel;