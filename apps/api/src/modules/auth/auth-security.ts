import { CanActivate, ExecutionContext, ForbiddenException, Injectable, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { User } from '@prisma/client';
export function validatePassword(value: string) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128 || Buffer.byteLength(value, 'utf8') > 72) throw new BadRequestException('Password must be 12–128 characters and at most 72 UTF-8 bytes.');
}
export function publicUser(user: User) {
  return { id: user.id, account: user.account, name: user.name, role: user.role, managerId: user.managerId, department: user.department, expiresAt: user.expiresAt, mustChangePassword: user.mustChangePassword };
}
export function sessionCookie(request: Request) {
  const matches = (request.headers.cookie || '').split(';').map((s) => s.trim()).filter((s) => s.startsWith('qc_session='));
  return matches.length === 1 ? matches[0].slice('qc_session='.length) : null;
}
export function requestPath(request: Request) { return request.path.replace(/\/+$/, '') || '/'; }
export function assertVisitorRoute(request: Request) {
  const path = requestPath(request), method = request.method;
  const get = ['/api/auth/me', '/api/auth/quotas', '/api/auth/business-options', '/api/videos'];
  const post = ['/api/auth/change-password', '/api/auth/logout', '/api/auth/logout-all', '/api/videos', '/api/videos/direct', '/api/videos/direct-upload-ticket'];
  const uuid = '[0-9a-f-]{36}';
  const readable = new RegExp(`^/api/(?:evaluation-jobs/${uuid}|videos/${uuid}(?:/(?:file|file-url|report|content-review/latest|content-reviews/${uuid}))?)$`, 'i');
  const mutable = new RegExp(`^/api/videos/(?:${uuid}/content-review|direct-upload-tickets/${uuid}/cancel)$`, 'i');
  if (!((method === 'GET' && (get.includes(path) || readable.test(path))) || (method === 'POST' && (post.includes(path) || mutable.test(path))))) throw new ForbiddenException('Visitor cannot access this resource.');
}
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
    const origin = process.env.WEB_ORIGIN || (process.env.NODE_ENV !== 'production' ? 'http://localhost:3000' : '');
    if (!origin || origin === '*' || request.headers.origin !== origin || request.headers['x-qc-csrf'] !== '1' || request.headers['sec-fetch-site'] === 'cross-site') throw new ForbiddenException('Same-origin request with X-QC-CSRF required.');
    return true;
  }
}
