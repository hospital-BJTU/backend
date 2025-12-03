const crypto = require('crypto');

// 存储验证码的临时对象（生产环境建议使用Redis）
const captchaStore = new Map();

// 导出captchaStore，供其他模块使用
module.exports.captchaStore = captchaStore;

// 清理过期验证码的定时器
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of captchaStore.entries()) {
        if (now - value.timestamp > 5 * 60 * 1000) { // 5分钟过期
            captchaStore.delete(key);
        }
    }
}, 60000); // 每分钟清理一次

/**
 * 生成随机四位数字
 */
function generateRandomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * 生成随机颜色
 */
function getRandomColor() {
    const colors = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
        '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * 生成干扰线
 */
function generateNoiseLine() {
    const x1 = Math.random() * 120;
    const y1 = Math.random() * 40;
    const x2 = Math.random() * 120;
    const y2 = Math.random() * 40;
    const color = getRandomColor();
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1" opacity="0.3"/>`;
}

/**
 * 生成SVG验证码图片
 */
function generateCaptchaSVG(code) {
    const width = 120;
    const height = 40;
    
    // 生成背景色
    const bgColor = '#f8f9fa';
    
    // 生成干扰线
    let noiseLines = '';
    for (let i = 0; i < 3; i++) {
        noiseLines += generateNoiseLine();
    }
    
    // 生成数字
    let numbers = '';
    for (let i = 0; i < code.length; i++) {
        const x = 15 + i * 25;
        const y = 25;
        const color = getRandomColor();
        const rotation = (Math.random() - 0.5) * 30; // -15到15度的旋转
        const fontSize = 18 + Math.random() * 4; // 18-22的字体大小
        
        numbers += `<text x="${x}" y="${y}" fill="${color}" font-size="${fontSize}" font-family="Arial, sans-serif" font-weight="bold" transform="rotate(${rotation} ${x} ${y})">${code[i]}</text>`;
    }
    
    // 生成干扰点
    let noisePoints = '';
    for (let i = 0; i < 20; i++) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        const color = getRandomColor();
        noisePoints += `<circle cx="${x}" cy="${y}" r="1" fill="${color}" opacity="0.5"/>`;
    }
    
    const svg = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="${bgColor}"/>
            ${noiseLines}
            ${noisePoints}
            ${numbers}
        </svg>
    `;
    
    return svg;
}

/**
 * 生成验证码
 */
const generateCaptcha = async (req, res) => {
    try {
        // 检查是否为测试环境
        const isTestMode = req.headers['x-test-mode'] === 'true' || 
                          process.env.NODE_ENV === 'test';
        
        // 生成四位数字验证码
        let code;
        if (isTestMode) {
            // 测试模式下使用固定的验证码值
            code = '1234';
        } else {
            // 生产模式下使用随机验证码
            code = generateRandomCode();
        }
        
        // 生成唯一标识符
        const captchaId = crypto.randomUUID();
        
        // 存储验证码（5分钟有效期）
        captchaStore.set(captchaId, {
            code: code.toLowerCase(),
            timestamp: Date.now(),
            isTestMode: isTestMode // 标记是否为测试模式生成的验证码
        });
        
        // 生成SVG图片
        const svgImage = generateCaptchaSVG(code);
        
        // 返回验证码ID和图片
        res.json({
            success: true,
            data: {
                captchaId: captchaId,
                image: `data:image/svg+xml;base64,${Buffer.from(svgImage).toString('base64')}`,
                // 在测试模式下返回验证码值（仅用于调试）
                ...(isTestMode && { debugCode: code })
            },
            message: '验证码生成成功'
        });
        
    } catch (error) {
        console.error('生成验证码失败:', error);
        res.status(500).json({
            success: false,
            message: '生成验证码失败'
        });
    }
};

/**
 * 验证验证码
 */
const verifyCaptcha = async (req, res) => {
    try {
        const { captchaId, code } = req.body;
        
        // 参数验证
        if (!captchaId || !code) {
            return res.status(400).json({
                success: false,
                message: '验证码ID和验证码不能为空'
            });
        }
        
        // 获取存储的验证码
        const storedCaptcha = captchaStore.get(captchaId);
        
        if (!storedCaptcha) {
            return res.status(400).json({
                success: false,
                message: '验证码已过期或不存在'
            });
        }
        
        // 检查是否过期（5分钟）
        if (Date.now() - storedCaptcha.timestamp > 5 * 60 * 1000) {
            captchaStore.delete(captchaId);
            return res.status(400).json({
                success: false,
                message: '验证码已过期'
            });
        }
        
        // 验证验证码（不区分大小写）
        if (code.toLowerCase() !== storedCaptcha.code) {
            return res.status(400).json({
                success: false,
                message: '验证码错误'
            });
        }
        
        // 验证成功后删除验证码（一次性使用）
        captchaStore.delete(captchaId);
        
        res.json({
            success: true,
            message: '验证码验证成功'
        });
        
    } catch (error) {
        console.error('验证验证码失败:', error);
        res.status(500).json({
            success: false,
            message: '验证验证码失败'
        });
    }
};

/**
 * 获取验证码统计信息（开发调试用）
 */
const getCaptchaStats = async (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                totalCaptchas: captchaStore.size,
                captchas: Array.from(captchaStore.entries()).map(([id, data]) => ({
                    id,
                    code: data.code,
                    createdAt: new Date(data.timestamp).toISOString(),
                    expiresAt: new Date(data.timestamp + 5 * 60 * 1000).toISOString()
                }))
            }
        });
    } catch (error) {
        console.error('获取验证码统计失败:', error);
        res.status(500).json({
            success: false,
            message: '获取验证码统计失败'
        });
    }
};

module.exports = {
    generateCaptcha,
    verifyCaptcha,
    getCaptchaStats,
    captchaStore // 也在这里导出，便于解构导入
};


