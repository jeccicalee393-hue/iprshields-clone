// api/video-upload.js
// Cấp token upload trực tiếp (client upload) để trình duyệt đẩy file video
// thẳng lên Vercel Blob, KHÔNG đi qua giới hạn 4.5MB của Serverless Function.
//
// POST /api/video-upload  -> được @vercel/blob/client gọi tự động (không tự gọi tay)
//
// Cần cài: npm install @vercel/blob (đã có sẵn trong package.json)
// Cần đặt biến môi trường ADMIN_PASSWORD giống như api/gallery.js

const { handleUpload } = require('@vercel/blob/client');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-admin-password');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // Mật khẩu admin được gửi kèm trong clientPayload (JSON string) từ trình duyệt,
        // vì bước cấp token này không nhất thiết nhận được custom header từ client SDK.
        let payload = {};
        try {
          payload = JSON.parse(clientPayload || '{}');
        } catch (e) {
          payload = {};
        }

        const expected = process.env.ADMIN_PASSWORD;
        if (!expected) {
          throw new Error('ADMIN_PASSWORD chưa được cấu hình trên Vercel.');
        }
        if (payload.password !== expected) {
          throw new Error('Sai mật khẩu admin.');
        }

        return {
          allowedContentTypes: [
            'video/mp4',
            'video/webm',
            'video/quicktime',
            'video/x-matroska',
            'video/*',
          ],
          // Giới hạn dung lượng ~2GB / video, chỉnh lại nếu cần
          maximumSizeInBytes: 2 * 1024 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({}),
        };
      },
      onUploadCompleted: async () => {
        // Không cần làm gì ở đây: admin.html sẽ tự POST metadata (title, thumbnail...)
        // sang /api/video ngay sau khi upload video xong.
        // Lưu ý: callback này chỉ được Vercel gọi khi deploy thật (không chạy trên localhost).
      },
    });

    return res.status(200).json(jsonResponse);
  } catch (err) {
    console.error(err);
    return res.status(400).json({ error: err.message || 'Lỗi tạo token upload.' });
  }
};
