const { DataTypes } = require('sequelize');
let WaitingList;

const WaitingListModel = {
  // 初始化模型
  initiate: (sequelize) => {
    WaitingList = sequelize.define('WaitingList', {
      waitingId: {
        field: 'waiting_id',
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        comment: '候补ID'
      },
      userId: {
        field: 'user_id',
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: '关联 tb_user 的ID（患者），外键'
      },
      scheduleId: {
        field: 'schedule_id',
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: '关联 tb_schedule 的ID，外键'
      },
      waitingNumber: {
        field: 'waiting_number',
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: '候补顺序号'
      },
      status: {
        field: 'status',
        type: DataTypes.ENUM('waiting', 'converted', 'cancelled', 'expired'),
        allowNull: false,
        defaultValue: 'waiting',
        comment: '候补状态: waiting(等待中), converted(已转正), cancelled(已取消), expired(已过期)'
      },
      waitingTime: {
        field: 'waiting_time',
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        comment: '加入候补队列时间'
      },
      convertedAt: {
        field: 'converted_at',
        type: DataTypes.DATE,
        allowNull: true,
        comment: '转正时间'
      },
      convertedToApptId: {
        field: 'converted_to_appt_id',
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: '转成的预约ID'
      }
    }, {
      tableName: 'tb_waiting_list',
      timestamps: false,
      indexes: [
        {
          name: 'idx_schedule_status',
          fields: ['schedule_id', 'status']
        },
        {
          name: 'idx_user_schedule',
          fields: ['user_id', 'schedule_id'],
          unique: true // 一个用户在同一个排班只能有一个候补记录
        }
      ]
    });

    return WaitingList;
  },
  // 获取WaitingList模型实例
  getModel: () => WaitingList
};

module.exports = WaitingListModel;

// 定义候补状态常量
module.exports.WAITING_STATUS = {
  WAITING: 'waiting',      // 等待中
  CONVERTED: 'converted',  // 已转正
  CANCELLED: 'cancelled',  // 已取消
  EXPIRED: 'expired'       // 已过期
};