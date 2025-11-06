const express = require('express');
const router = express.Router();
const { generateCaptcha, verifyCaptcha, getCaptchaStats } = require('../controllers/captchaController');

/**
 * @route   GET /api/captcha/generate
 * @desc    生成验证码
 * @access  Public
 */
router.get('/generate', generateCaptcha);

/**
 * @route   POST /api/captcha/verify
 * @desc    验证验证码
 * @access  Public
 * @body    { captchaId: string, code: string }
 */
router.post('/verify', verifyCaptcha);

/**
 * @route   GET /api/captcha/stats
 * @desc    获取验证码统计信息（开发调试用）
 * @access  Public
 */
router.get('/stats', getCaptchaStats);

module.exports = router;


