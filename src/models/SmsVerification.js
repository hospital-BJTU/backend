const { DataTypes } = require('sequelize');

// 定义短信验证码模型
let SmsVerification;

const SmsVerificationModel = {
  // 初始化模型
  initiate: (sequelize) => {
    SmsVerification = sequelize.define('SmsVerification', {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        comment: '记录ID'
      },
      phone: {
        type: DataTypes.STRING(20),
        allowNull: false,
        comment: '手机号码'
      },
      code: {
        type: DataTypes.STRING(6),
        allowNull: false,
        comment: '验证码'
      },
      purpose: {
        type: DataTypes.ENUM('login', 'register', 'reset_password'),
        allowNull: false,
        defaultValue: 'reset_password',
        comment: '验证码用途'
      },
      status: {
        type: DataTypes.ENUM('pending', 'used', 'expired'),
        allowNull: false,
        defaultValue: 'pending',
        comment: '验证码状态'
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: '过期时间'
      },
      createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        comment: '创建时间'
      }
    }, {
      tableName: 'tb_sms_verification',
      timestamps: false // 禁用默认时间戳
    });
    return SmsVerification;
  }
};

module.exports = SmsVerificationModel;