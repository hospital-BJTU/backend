const { DataTypes } = require('sequelize');

// 定义通用审计日志模型 - 对应 tb_audit_log 表
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
        allowNull: false,
        comment: '日志ID'
      },
      // 新通用字段
      actionType: {
        field: 'action_type',
        type: DataTypes.ENUM('schedule_audit', 'user_status_change'),
        allowNull: true,
        comment: '操作类型: schedule_audit(排班审核), user_status_change(用户状态变更)'
      },
      targetId: {
        field: 'target_id',
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: '目标ID，如schedule_id或user_id'
      },
      adminId: {
        field: 'admin_id',
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: '关联 tb_user 的ID（管理员），外键'
      },
      actionResult: {
        field: 'action_result',
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: '操作结果，如approved/rejected或用户状态值'
      },
      reason: {
        field: 'reason',
        type: DataTypes.STRING(512),
        comment: '操作原因'
      },
      details: {
        field: 'details',
        type: DataTypes.TEXT,
        comment: '操作详情，JSON格式'
      },
      actionTime: {
        field: 'action_time',
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        comment: '操作时间'
      },
      // 向后兼容的旧字段
      scheduleId: {
        field: 'schedule_id',
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: '关联 tb_schedule 的ID（向后兼容）'
      },
      auditResult: {
        field: 'audit_result',
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: '审核结果（向后兼容）'
      },
      auditTime: {
        field: 'audit_time',
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        comment: '审核时间（向后兼容）'
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

// 智能创建审计日志方法，支持新旧字段
AuditLogModel.createSmartLog = async (logData, options) => {
  const AuditLog = AuditLogModel.getModel();
  const smartData = { ...logData };
  
  // 自动填充新旧字段映射
  // 只有在与排班相关的操作时，才将targetId映射到scheduleId
  // 避免用户状态变更等操作时将用户ID错误地作为scheduleId插入
  if (smartData.targetId && !smartData.scheduleId && smartData.actionType === 'schedule_audit') {
    smartData.scheduleId = smartData.targetId;
  }
  // 只有在排班审核操作时才将actionResult映射到auditResult
  // 因为auditResult是仅接受'approved'和'rejected'的枚举类型
  if (smartData.actionResult && !smartData.auditResult && smartData.actionType === 'schedule_audit') {
    smartData.auditResult = smartData.actionResult;
  }
  if (smartData.actionTime && !smartData.auditTime) {
    smartData.auditTime = smartData.actionTime;
  }
  
  // 反向映射：如果提供了旧字段，也映射到新字段
  if (smartData.scheduleId && !smartData.targetId) {
    smartData.targetId = smartData.scheduleId;
    // 推断操作类型
    if (!smartData.actionType) {
      smartData.actionType = 'schedule_audit';
    }
  }
  if (smartData.auditResult && !smartData.actionResult) {
    smartData.actionResult = smartData.auditResult;
  }
  if (smartData.auditTime && !smartData.actionTime) {
    smartData.actionTime = smartData.auditTime;
  }
  
  // 关键修复：对于用户状态变更操作，查询一个有效的排班ID
  // 因为数据库表结构要求schedule_id不能为空且必须引用有效的排班ID
  if (smartData.actionType === 'user_status_change' && !smartData.scheduleId) {
    try {
      // 查询一个有效的排班ID - 直接使用第一个排班的ID
      const Schedule = require('./Schedule').getModel();
      const schedule = await Schedule.findOne({
        attributes: ['scheduleId'],
        order: [['scheduleId', 'ASC']]
      });
      
      if (schedule) {
        smartData.scheduleId = schedule.scheduleId;
      } else {
        // 如果没有任何排班，抛出错误
        throw new Error('无法创建审计日志：数据库中没有任何排班记录');
      }
    } catch (error) {
      console.error('查询排班ID失败:', error);
      throw error;
    }
  }
  
  return AuditLog.create(smartData, options);
};


module.exports = AuditLogModel;