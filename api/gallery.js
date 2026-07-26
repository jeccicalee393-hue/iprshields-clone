// api/gallery.js
// Backend API cho trang Gallery - lưu ảnh bằng Vercel Blob Storage
//
// GET    /api/gallery          -> trả về danh sách tất cả ảnh (public, ai xem web cũng gọi được)
// POST   /api/gallery          -> thêm ảnh mới (yêu cầu mật khẩu admin qua header x-admin-password)
// DELETE /api/gallery?id=xxx   -> xoá ảnh (yêu cầu mật khẩu admin)
//
// Cần cài: npm install @vercel/blob
// Cần bật Blob Storage trong Vercel Dashboard (Storage -> Create Database -> Blob)
// Cần đặt biến môi trường ADMIN_PASSWORD trong Vercel Project Settings -> Environment Variables

const { put, del, list } = require('@vercel/blob');

const DATA_PREFIX = 'data/gallery/';
const IMAGE_PREFIX = 'images/';

function checkAuth(req) {
  const provided = req.headers['x-admin-password'];
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    // Nếu chưa cấu hình mật khẩu, chặn luôn để tránh bị public ghi đè dữ liệu
    return { ok: false, reason: 'ADMIN_PASSWORD chưa được cấu hình trên Vercel.' };
  }
  if (provided !== expected) {
    return { ok: false, reason: 'Sai mật khẩu admin.' };
  }
  return { ok: true };
}

module.exports = async function handler(req, res) {
  // Cho phép gọi từ chính domain của web (đơn giản hoá CORS cho cùng origin)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-admin-password');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const { blobs } = await list({ prefix: DATA_PREFIX });
      const items = await Promise.all(
        blobs.map(async (b) => {
          const r = await fetch(b.url);
          return r.json();
        })
      );
      items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      return res.status(200).json(items);
    }

    if (req.method === 'POST') {
      const auth = checkAuth(req);
      if (!auth.ok) return res.status(401).json({ error: auth.reason });

      const { title, cat, channel, desc, headline, imageBase64, filename, contentType, views, likes } = req.body || {};

      if (!title || !imageBase64 || !filename) {
        return res.status(400).json({ error: 'Thiếu title, imageBase64 hoặc filename.' });
      }

      // Giới hạn kích thước ảnh (~4.3MB base64 để tránh vượt giới hạn body của serverless function)
      if (imageBase64.length > 4.3 * 1024 * 1024 * 1.37) {
        return res.status(413).json({ error: 'Ảnh quá lớn. Vui lòng nén/resize trước khi upload (khuyến nghị < 3MB).' });
      }

      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const buffer = Buffer.from(imageBase64, 'base64');

      const imageBlob = await put(`${IMAGE_PREFIX}${id}-${filename}`, buffer, {
        access: 'public',
        contentType: contentType || 'image/jpeg',
      });

      const item = {
        id,
        title,
        cat: cat || 'FILM & CINEMA',
        img: imageBlob.url,
        channel: channel || 'Luma Media',
        subs: '',
        avatar: 'https://i.pravatar.cc/100?img=1',
        views: views || '0',
        likes: likes || '0',
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        headline: headline || title,
        desc: desc || '',
        extra: '',
        comments: [],
        createdAt: Date.now(),
      };

      await put(`${DATA_PREFIX}${id}.json`, JSON.stringify(item), {
        access: 'public',
        contentType: 'application/json',
      });

      return res.status(200).json(item);
    }

    if (req.method === 'PUT') {
      const auth = checkAuth(req);
      if (!auth.ok) return res.status(401).json({ error: auth.reason });

      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Thiếu id.' });

      const { blobs } = await list({ prefix: `${DATA_PREFIX}${id}.json` });
      if (!blobs[0]) return res.status(404).json({ error: 'Không tìm thấy ảnh.' });

      const r = await fetch(blobs[0].url);
      const existing = await r.json();

      const { title, cat, channel, desc, views, likes, date, newComment } = req.body || {};

      const updated = {
        ...existing,
        title: title ?? existing.title,
        cat: cat ?? existing.cat,
        channel: channel ?? existing.channel,
        desc: desc ?? existing.desc,
        views: views ?? existing.views,
        likes: likes ?? existing.likes,
        date: date ?? existing.date,
        comments: existing.comments || [],
      };

      if (newComment && newComment.text) {
        updated.comments = [
          {
            name: newComment.name || 'Ẩn danh',
            avatar: newComment.avatar || 'https://i.pravatar.cc/100?img=' + (Math.floor(Math.random() * 60) + 1),
            date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            text: newComment.text,
            likes: newComment.likes || 0,
          },
          ...updated.comments,
        ];
      }

      await put(`${DATA_PREFIX}${id}.json`, JSON.stringify(updated), {
        access: 'public',
        contentType: 'application/json',
        allowOverwrite: true,
      });

      return res.status(200).json(updated);
    }

    if (req.method === 'DELETE') {
      const auth = checkAuth(req);
      if (!auth.ok) return res.status(401).json({ error: auth.reason });

      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Thiếu id.' });

      // Tìm blob metadata để lấy URL ảnh cần xoá kèm theo
      const { blobs } = await list({ prefix: `${DATA_PREFIX}${id}.json` });
      if (blobs[0]) {
        const r = await fetch(blobs[0].url);
        const item = await r.json();
        if (item.img) {
          await del(item.img).catch(() => {});
        }
        await del(blobs[0].url);
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Lỗi server.' });
  }
};
        
