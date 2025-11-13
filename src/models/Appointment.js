const { DataTypes } = require('sequelize');
let Appointment;

const AppointmentModel = {
  // 初始化模型
  initiate: (sequelize) => {
    Appointment = sequelize.define('Appointment', {
      apptId: {
        field: 'appt_id',
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        comment: '预约ID'
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
      serialNumber: {
        field: 'serial_number',
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: '叫号顺序号'
      },
      scheduleDate: {
        field: 'schedule_date', // 必须匹配数据库列名
        type: DataTypes.DATEONLY, // 使用 DATEONLY 确保只存储日期
        allowNull: false, // 必须为 false 以匹配数据库的 NOT NULL 约束
        comment: '预约的就诊日期'
      },
      status: {
        field: 'status',
        type: DataTypes.ENUM('pending', 'called', 'completed', 'missed', 'cancelled'),
        allowNull: false,
        defaultValue: 'pending',
        comment: '预约状态: pending(待就诊), called(待叫号), completed(已完成), missed(已过号), cancelled(已取消)'
      },
      isValid: {
        field: 'is_valid',
        type: DataTypes.TINYINT(1),
        allowNull: false,
        defaultValue: 1,
        comment: '是否有效 (1: 有效, 0: 无效)'
      },
      appointmentTime: {
        field: 'appointment_time',
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        comment: '挂号时间'
      }
    }, {
      tableName: 'tb_appointment',
      timestamps: false,
      indexes: [
        {
          unique: true,
          name: 'uk_schedule_serial',
          fields: ['schedule_id', 'serial_number']
        }
      ]
    });

    
    return Appointment;
  },
  // 获取Appointment模型实例
  getModel: () => Appointment
};

module.exports = AppointmentModel;