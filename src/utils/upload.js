const multer = require('multer');
const path = require('path');

// 配置存储
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // 存储路径：src/public/uploads/avatars
    cb(null, path.join(__dirname, '../public/uploads/avatars'));
  },
  filename: (req, file, cb) => {
    // 生成唯一文件名：userId-时间戳-原文件扩展名
    // 确保文件名唯一，避免冲突
    const userId = req.user.userId;
    const timestamp = Date.now();
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${userId}-${timestamp}${ext}`;
    cb(null, uniqueName);
  }
});

// 文件类型过滤
const fileFilter = (req, file, cb) => {
  // 只允许上传图片文件
  const allowedTypes = /jpeg|jpg|png|gif/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  
  if (extname && mimetype) {
    return cb(null, true);
  }
  
  cb(new Error('只允许上传图片文件（JPEG、JPG、PNG、GIF）'));
};

// 创建multer实例
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 限制文件大小为5MB
  }
});

// 导出单个文件上传中间件，字段名为'avatar'
const uploadAvatar = upload.single('avatar');

module.exports = {
  uploadAvatar
};