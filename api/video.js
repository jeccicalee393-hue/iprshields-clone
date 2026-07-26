
// api/video.js
// Backend API cho danh sách Video - lưu metadata bằng Vercel Blob Storage.
// File video thật được trình duyệt upload TRỰC TIẾP lên Blob qua /api/video-upload
// (client upload), sau đó trình duyệt gọi các route dưới đây để lưu/sửa/xoá metadata.
//
// GET    /api/video          -> trả về danh sách tất cả video (public)
// POST   /api/video          -> lưu metadata sau khi đã upload video xong (cần x-admin-password)
// PUT    /api/video?id=xxx   -> sửa thông tin / thêm bình luận (cần x-admin-password)
// DELETE /api/video?id=xxx   -> xoá video + thumbnail (cần x-admin-password)
//
// Cần cài: npm install @vercel/blob
// Cần bật Blob Storage trong Vercel Dashboard (Storage -> Create Database -> Blob)
// Cần đặt biến môi trường ADMIN_PASSWORD (giống api/gallery.js)

const { put, del, list } = require('@vercel/blob');

const DATA_PREFIX = 'data/videos/';
const THUMB_PREFIX = 'video-thumbs/';

function checkAuth(req) {
  const provided = req.headers['x-admin-password'];
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return { ok: false, reason: 'ADMIN_PASSWORD chưa được cấu hình trên Vercel.' };
  }
  if (provided !== expected) {
    return { ok: false, reason: 'Sai mật khẩu admin.' };
  }
  return { ok: true };
}

module.exports = async function handler(req, res) {
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

      const {
        title, category, filterCat, channel, desc, hashtag, tags,
        views, likes, duration, videoUrl,
        thumbBase64, thumbFilename, thumbContentType,
      } = req.body || {};

      if (!title || !videoUrl) {
        return res.status(400).json({ error: 'Thiếu title hoặc videoUrl (video chưa upload xong).' });
      }

      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

      // Thumbnail (ảnh nhỏ, base64) được upload qua chính function này vì kích thước nhỏ.
      let thumbUrl = '';
      if (thumbBase64) {
        const buffer = Buffer.from(thumbBase64, 'base64');
        const safeThumbName = (thumbFilename || 'thumb.jpg').replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const thumbBlob = await put(`${THUMB_PREFIX}${id}-${safeThumbName}`, buffer, {
          access: 'public',
          contentType: thumbContentType || 'image/jpeg',
        });
        thumbUrl = thumbBlob.url;
      }

      let tagsArr = [];
      if (Array.isArray(tags)) tagsArr = tags;
      else if (typeof tags === 'string' && tags.trim()) {
        tagsArr = tags.split(',').map((t) => t.trim()).filter(Boolean);
      }

      const item = {
        id,
        title,
        category: category || 'FILM & CINEMA',
        filterCat: filterCat || category || 'Film & Cinema',
        videoUrl,
        thumb: thumbUrl,
        duration: duration || '00:00',
        tags: tagsArr,
        channel: channel || 'Luma Media',
        subs: '',
        avatar: 'https://i.pravatar.cc/100?img=1',
        views: views || '0',
        likes: likes || '0',
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        hashtag: hashtag || '',
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
      if (!blobs[0]) return res.status(404).json({ error: 'Không tìm thấy video.' });

      const r = await fetch(blobs[0].url);
      const existing = await r.json();

      const { title, category, channel, desc, views, likes, date, duration, newComment } = req.body || {};

      const updated = {
        ...existing,
        title: title ?? existing.title,
        category: category ?? existing.category,
        channel: channel ?? existing.channel,
        desc: desc ?? existing.desc,
        views: views ?? existing.views,
        likes: likes ?? existing.likes,
        date: date ?? existing.date,
        duration: duration ?? existing.duration,
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

      const { blobs } = await list({ prefix: `${DATA_PREFIX}${id}.json` });
      if (blobs[0]) {
        const r = await fetch(blobs[0].url);
        const item = await r.json();
        if (item.videoUrl) await del(item.videoUrl).catch(() => {});
        if (item.thumb) await del(item.thumb).catch(() => {});
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
                                                                             
