import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import COS = require('cos-nodejs-sdk-v5');
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

const COS_SCHEME = 'cos://';
export const VIDEO_COS_CLIENT = Symbol('VIDEO_COS_CLIENT');

type UploadedVideo = Pick<Express.Multer.File, 'path' | 'mimetype' | 'size'>;

export type MaterializedVideo = {
  path: string;
  cleanup: () => Promise<void>;
};

function projectRoot() {
  return resolve(process.cwd(), '../../');
}

function localStorageDir() {
  return resolve(projectRoot(), process.env.VIDEO_STORAGE_DIR || './storage/videos');
}

function requireEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when VIDEO_STORAGE_PROVIDER=cos.`);
  return value;
}

function safeExtension(filePath: string) {
  const extension = extname(filePath).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : '.mp4';
}

function normalizePrefix(value: string | undefined) {
  return (value?.trim() || 'ai-video-qc/videos').replace(/^\/+|\/+$/g, '');
}

function assertLocalVideoPath(filePath: string) {
  const base = localStorageDir();
  const absolutePath = resolve(projectRoot(), filePath);
  const relativePath = relative(base, absolutePath);
  if (
    !relativePath
    || relativePath === '..'
    || relativePath.startsWith(`..${sep}`)
    || isAbsolute(relativePath)
  ) {
    throw new Error('Video file path is invalid.');
  }
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    throw new Error('Video file is unavailable.');
  }
  return absolutePath;
}

@Injectable()
export class VideoStorageService {
  private readonly logger = new Logger(VideoStorageService.name);
  private cosClient?: Pick<COS, 'putObject' | 'deleteObject' | 'getObject' | 'getObjectUrl' | 'headObject'> & Partial<Pick<COS, 'putObjectCopy'>>;

  constructor(
    @Optional() @Inject(VIDEO_COS_CLIENT)
    private readonly injectedCosClient?: Pick<COS, 'putObject' | 'deleteObject' | 'getObject' | 'getObjectUrl' | 'headObject'> & Partial<Pick<COS, 'putObjectCopy'>>,
  ) {}

  isCosEnabled() {
    return process.env.VIDEO_STORAGE_PROVIDER?.trim().toLowerCase() === 'cos';
  }

  isCosPath(filePath: string) {
    return filePath.startsWith(COS_SCHEME);
  }

  async storeUploadedFile(file: UploadedVideo) {
    if (!this.isCosEnabled()) {
      return relative(projectRoot(), file.path);
    }

    const bucket = requireEnvironment('COS_BUCKET');
    const key = `${normalizePrefix(process.env.COS_VIDEO_PREFIX)}/${randomUUID()}${safeExtension(file.path)}`;
    try {
      await this.cos().putObject({
        Bucket: bucket,
        Region: requireEnvironment('COS_REGION'),
        Key: key,
        Body: createReadStream(file.path),
        ContentLength: file.size,
        ContentType: file.mimetype,
        ACL: 'private',
      });
      return `${COS_SCHEME}${bucket}/${key}`;
    } finally {
      await this.removeLocalFile(file.path);
    }
  }

  async deleteStoredFile(filePath: string) {
    if (this.isCosPath(filePath)) {
      const { bucket, key } = this.parseCosPath(filePath);
      await this.cos().deleteObject({
        Bucket: bucket,
        Region: requireEnvironment('COS_REGION'),
        Key: key,
      });
      return;
    }
    await this.removeLocalFile(resolve(projectRoot(), filePath));
  }

  async createReadUrl(filePath: string) {
    const { bucket, key } = this.parseCosPath(filePath);
    const expires = Number(process.env.COS_SIGNED_URL_TTL_SECONDS || 900);
    return this.cos().getObjectUrl({
      Bucket: bucket,
      Region: requireEnvironment('COS_REGION'),
      Key: key,
      Sign: true,
      Method: 'GET',
      Expires: Number.isInteger(expires) && expires > 0 ? Math.min(expires, 900) : 900,
      Protocol: 'https:',
    });
  }

  async createDirectUpload(userId: string, fileName: string, mimeType: string, fileSizeBytes: number, operationId: string = randomUUID(), requestedExpiresInSeconds = 900) {
    if (!this.isCosEnabled()) {
      throw new BadRequestException('Direct upload is only available with COS storage.');
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
      throw new BadRequestException('Invalid direct upload operation identifier.');
    }
    const safeName = basename(fileName).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120) || 'video.mp4';
    const key = `${normalizePrefix(process.env.COS_VIDEO_PREFIX)}/${userId}/${operationId}-${safeName}`;
    const bucket = requireEnvironment('COS_BUCKET');
    const expires = Number.isInteger(requestedExpiresInSeconds) ? Math.min(900, Math.max(1, requestedExpiresInSeconds)) : 900;
    const uploadUrl = this.cos().getObjectUrl({
      Bucket: bucket,
      Region: requireEnvironment('COS_REGION'),
      Key: key,
      Sign: true,
      Method: 'PUT',
      Expires: expires,
      Protocol: 'https:',
      Headers: { 'Content-Length': String(fileSizeBytes), 'x-cos-acl': 'private' },
    });
    return {
      uploadUrl,
      objectPath: `${COS_SCHEME}${bucket}/${key}`,
      expiresInSeconds: expires,
      headers: { 'Content-Type': mimeType, 'x-cos-acl': 'private' },
      fileSizeBytes,
    };
  }

  async verifyDirectUpload(
    filePath: string,
    userId: string,
    expected: { mimeType: string; fileSizeBytes: number },
  ) {
    const { bucket, key } = this.parseCosPath(filePath);
    const ownerPrefix = `${normalizePrefix(process.env.COS_VIDEO_PREFIX)}/${userId}/`;
    if (!key.startsWith(ownerPrefix)) throw new BadRequestException('The uploaded video does not belong to this user.');

    let result: Awaited<ReturnType<COS['headObject']>>;
    try {
      result = await this.cos().headObject({
        Bucket: bucket,
        Region: requireEnvironment('COS_REGION'),
        Key: key,
      });
    } catch {
      throw new BadRequestException('The uploaded video was not found in COS.');
    }
    const actualSize = Number(result.headers?.['content-length']);
    const actualType = String(result.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!Number.isSafeInteger(actualSize) || actualSize !== expected.fileSizeBytes) {
      throw new BadRequestException('The uploaded video size does not match the upload request.');
    }
    if (actualType && actualType !== expected.mimeType.toLowerCase()) {
      throw new BadRequestException('The uploaded video type does not match the upload request.');
    }
    return { etag: String(result.headers?.etag || ''), actualSize };
  }

  allocateFinalPath(userId: string) {
    return `${COS_SCHEME}${requireEnvironment('COS_BUCKET')}/${normalizePrefix(process.env.COS_VIDEO_PREFIX)}/sealed/${userId}/${randomUUID()}.mp4`;
  }

  async finalizeDirectUpload(sourcePath: string, userId: string, expected: { mimeType: string; fileSizeBytes: number }, targetPath: string) {
    const source = this.parseCosPath(sourcePath), target = this.parseCosPath(targetPath);
    if (!target.key.startsWith(`${normalizePrefix(process.env.COS_VIDEO_PREFIX)}/sealed/${userId}/`) || sourcePath === targetPath) throw new BadRequestException('Invalid sealed upload destination.');
    // Simple Copy only: never silently switch to multipart or request broader permissions.
    if (expected.fileSizeBytes > 500 * 1024 * 1024) throw new BadRequestException('Direct upload is limited to 500 MiB.');
    const verified = await this.verifyDirectUpload(sourcePath, userId, expected);
    if (!verified.etag) throw new BadRequestException('Source ETag is required.');
    const client = this.cos();
    if (!client.putObjectCopy) throw new BadRequestException('Conditional copy is unavailable.');
    try {
      await client.putObjectCopy({ Bucket: target.bucket, Region: requireEnvironment('COS_REGION'), Key: target.key,
        CopySource: `${source.bucket}.cos.${requireEnvironment('COS_REGION')}.myqcloud.com/${source.key.split('/').map(encodeURIComponent).join('/')}`,
        CopySourceIfMatch: verified.etag, ACL: 'private', MetadataDirective: 'Copy' });
      const final = await client.headObject({ Bucket: target.bucket, Region: requireEnvironment('COS_REGION'), Key: target.key });
      const size = Number(final.headers?.['content-length']);
      const type = String(final.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!Number.isSafeInteger(size) || size !== expected.fileSizeBytes || type !== expected.mimeType.toLowerCase()) throw new BadRequestException('Sealed upload size or type mismatch.');
      return targetPath;
    } catch (error) {
      // Destination was independently allocated for this ticket, never the source/shared video.
      await this.deleteStoredFile(targetPath).catch(() => undefined);
      throw error;
    }
  }

  async materialize(filePath: string): Promise<MaterializedVideo> {
    if (!this.isCosPath(filePath)) {
      return { path: assertLocalVideoPath(filePath), cleanup: async () => undefined };
    }

    const { bucket, key } = this.parseCosPath(filePath);
    const tempBase = process.env.VIDEO_UPLOAD_TEMP_DIR?.trim()
      ? resolve(process.env.VIDEO_UPLOAD_TEMP_DIR)
      : resolve(tmpdir(), 'ai-video-qc');
    await mkdir(tempBase, { recursive: true });
    const tempPath = resolve(tempBase, `${randomUUID()}${safeExtension(key)}`);
    const output = createWriteStream(tempPath, { flags: 'wx' });

    try {
      await this.cos().getObject({
        Bucket: bucket,
        Region: requireEnvironment('COS_REGION'),
        Key: key,
        Output: output,
      });
      return {
        path: tempPath,
        cleanup: () => this.removeLocalFile(tempPath),
      };
    } catch (error) {
      output.destroy();
      await this.removeLocalFile(tempPath);
      throw error;
    }
  }

  ensureUploadDirectory() {
    const directory = this.isCosEnabled()
      ? resolve(process.env.VIDEO_UPLOAD_TEMP_DIR?.trim() || resolve(tmpdir(), 'ai-video-qc', 'uploads'))
      : localStorageDir();
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
    return directory;
  }

  private cos() {
    if (!this.cosClient) {
      this.cosClient = this.injectedCosClient ?? new COS({
        SecretId: requireEnvironment('TENCENTCLOUD_SECRET_ID'),
        SecretKey: requireEnvironment('TENCENTCLOUD_SECRET_KEY'),
        SecurityToken: process.env.TENCENTCLOUD_SESSION_TOKEN?.trim() || undefined,
        Protocol: 'https:',
      });
    }
    return this.cosClient;
  }

  private parseCosPath(filePath: string) {
    if (!this.isCosPath(filePath)) throw new Error('Video file is not stored in COS.');
    const withoutScheme = filePath.slice(COS_SCHEME.length);
    const slashIndex = withoutScheme.indexOf('/');
    const bucket = slashIndex > 0 ? withoutScheme.slice(0, slashIndex) : '';
    const key = slashIndex > 0 ? withoutScheme.slice(slashIndex + 1) : '';
    if (!bucket || !key || key.includes('..')) throw new Error('COS video path is invalid.');
    const configuredBucket = requireEnvironment('COS_BUCKET');
    if (bucket !== configuredBucket) throw new Error('COS video bucket is not allowed.');
    return { bucket, key };
  }

  private async removeLocalFile(filePath: string) {
    try {
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.error('Failed to remove a temporary video file.');
      }
    }
  }
}
