const { DataTypes } = require('sequelize');

// 定义排班模型 - 对应 tb_schedule 表
let Schedule;

const ScheduleModel = {
  // 初始化模型
  initiate: (sequelize) => {
    Schedule = sequelize.define('Schedule', {
      scheduleId: {
        field: 'schedule_id',
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        comment: '排班ID'
      },
      doctorId: {
        field: 'doctor_id',
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: '关联 tb_doctor 的ID，外键'
      },
      scheduleDate: {
        field: 'schedule_date',
        type: DataTypes.DATEONLY,
        allowNull: false,
        comment: '出诊日期'
      },
      timeSlot: {
        field: 'time_slot',
        type: DataTypes.ENUM(
          '08:00-09:00', '09:00-10:00', '10:00-11:00', '11:00-12:00',
          '14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:00'
        ),
        allowNull: false,
        comment: '时间段'
      },
      maxCount: {
        field: 'max_count',
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: '最大接诊能力'
      },
      availableCount: {
        field: 'available_count',
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: '当前余号数'
      },
      auditStatus: {
        field: 'audit_status',
        type: DataTypes.ENUM('pending', 'approved', 'rejected'),
        allowNull: false,
        defaultValue: 'pending',
        comment: '审核状态: pending(待审核), approved(已通过), rejected(已拒绝)'
      },
      allowWaiting: {
        field: 'allow_waiting',
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false,
        comment: '是否开放候补功能，默认为true'
      },
      waitingListLimit: {
        field: 'waiting_list_limit',
        type: DataTypes.INTEGER,
        defaultValue: 2,
        allowNull: true,
        comment: '候补队列名额限制，默认为2个'
      }
    }, {
      tableName: 'tb_schedule',
      timestamps: false,
      indexes: [
        {
          unique: true,
          name: 'uk_doctor_date_slot',
          fields: ['doctor_id', 'schedule_date', 'time_slot']
        }
      ]
    });

    return Schedule;
  },
  // 获取Schedule模型实例
  getModel: () => Schedule
};

module.exports = ScheduleModel;