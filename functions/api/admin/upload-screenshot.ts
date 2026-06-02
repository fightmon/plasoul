/**
 * 上傳截圖到 R2 + 寫 batch_images 表
 *
 * POST /api/admin/upload-screenshot
 * Body: { mime, base64, batch_id? }
 *   - batch_id 可選；若無則先用 temp，batch-save 時會再 link
 *
 * Returns: { ok: true, image_id, r2_key, url }
 */

import { requireAdmin } from '../../_lib/auth';

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  JWT_SECRET: string;
}

const MAX_BYTES = 4 * 1024 * 1024;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const authResult = await requireAdmin(context.request, context.env.JWT_SECRET);
  if (authResult instanceof Response) return authResult;
  const user = authResult;

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return jsonError('INVALID_REQUEST', '請求格式錯誤', 400);
  }

  const mime = String(body.mime || '').trim();
  const base64 = String(body.base64 || '').trim();
  const batchId = String(body.batch_id || '').trim() || `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (!mime || !base64) {
    return jsonError('MISSING_FIELDS', '請帶 mime 跟 base64', 400);
  }
  if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(mime)) {
    return jsonError('UNSUPPORTED_MIME', `不支援的圖片類型: ${mime}`, 400);
  }
  const estimatedBytes = Math.floor((base64.length * 3) / 4);
  if (estimatedBytes > MAX_BYTES) {
    return jsonError('IMAGE_TOO_LARGE', `圖片太大 (>${MAX_BYTES / 1024 / 1024}MB)`, 400);
  }

  // decode base64
  let bytes: Uint8Array;
  try {
    const binary = atob(base64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    return jsonError('INVALID_BASE64', 'base64 解碼失敗', 400);
  }

  // 生成 r2_key
  const now = Date.now();
  const date = new Date(now);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const ext = mime.split('/')[1].replace('jpeg', 'jpg');
  const random = Math.random().toString(36).slice(2, 10);
  const r2Key = `screenshots/${y}${m}${d}/${now}_${random}.${ext}`;

  // upload to R2
  try {
    await context.env.R2.put(r2Key, bytes, {
      httpMetadata: { contentType: mime },
      customMetadata: { uploadedBy: user.sub, batchId },
    });
  } catch (e: any) {
    return jsonError('R2_UPLOAD_FAILED', `R2 上傳失敗: ${e?.message || 'unknown'}`, 500);
  }

  // insert batch_images
  const imageId = 'img_' + now + '_' + Math.random().toString(36).slice(2, 8);
  try {
    await context.env.DB.prepare(
      `INSERT INTO batch_images (id, batch_id, r2_key, mime, size_bytes, uploaded_by, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(imageId, batchId, r2Key, mime, bytes.byteLength, user.sub, now)
      .run();
  } catch (e: any) {
    // R2 已上傳，DB 失敗 → log but 不 rollback（R2 留著也沒事，下次 GC）
    return jsonError('DB_INSERT_FAILED', `寫入 batch_images 失敗: ${e?.message}`, 500);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      image_id: imageId,
      r2_key: r2Key,
      batch_id: batchId,
      url: `/api/screenshot/${encodeURIComponent(r2Key)}`,
      size_bytes: bytes.byteLength,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    }
  );
};

function jsonError(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, code, message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
