const express = require('express');
const router = express.Router();
const qrcodeController = require('../controllers/qrcodeController');

/**
 * 二维码相关路由
 */

// 生成通用签到二维码
router.get('/generate-sign-in-qr', qrcodeController.generateSignInQrCode);

// 生成带有科室和医生信息的签到二维码
router.get('/generate-dept-doctor-qr', qrcodeController.generateDeptDoctorQrCode);

// 获取签到页面配置信息
router.get('/sign-in-page-config', qrcodeController.getSignInPageConfig);

module.exports = router;
