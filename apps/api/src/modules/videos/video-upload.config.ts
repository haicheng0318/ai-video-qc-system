import { BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { diskStorage } from 'multer';

const allowedMimeTypes = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

export function getStorageDir() {
  return resolve(process.cwd(), '../../', process.env.VIDEO_STORAGE_DIR || './storage/videos');
}

function getMaxVideoSizeBytes() {
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
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new BadRequestException('Only MP4, MOV, and WEBM videos are supported.'), false);
      return;
    }
    callback(null, true);
  },
});
