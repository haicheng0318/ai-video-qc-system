import { BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { diskStorage } from 'multer';

export const allowedVideoMimeTypes = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

export function getStorageDir() {
  if (process.env.VIDEO_STORAGE_PROVIDER?.trim().toLowerCase() === 'cos') {
    return resolve(process.env.VIDEO_UPLOAD_TEMP_DIR?.trim() || resolve(tmpdir(), 'ai-video-qc', 'uploads'));
  }
  return resolve(process.cwd(), '../../', process.env.VIDEO_STORAGE_DIR || './storage/videos');
}

export function getMaxVideoSizeBytes() {
  const maxMb = Number(process.env.MAX_VIDEO_SIZE_MB || 500);
  return maxMb * 1024 * 1024;
}

export const videoUploadInterceptor = FileInterceptor('file', {
  storage: diskStorage({
    destination: (_req, _file, callback) => {
      const storageDir = getStorageDir();
      if (!existsSync(storageDir)) mkdirSync(storageDir, { recursive: true });
      callback(null, storageDir);
    },
    filename: (_req, file, callback) => {
      callback(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`);
    },
  }),
  limits: { fileSize: getMaxVideoSizeBytes() },
  fileFilter: (_req, file, callback) => {
    const key = _req.headers['idempotency-key'];
    if (typeof key !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
      callback(new BadRequestException('A UUID Idempotency-Key header is required for upload.'), false);
      return;
    }
    if (!allowedVideoMimeTypes.has(file.mimetype)) {
      callback(new BadRequestException('Only MP4, MOV, and WEBM videos are supported.'), false);
      return;
    }
    callback(null, true);
  },
});
