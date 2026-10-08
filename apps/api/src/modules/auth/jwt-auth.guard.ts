import { ExecutionContext, ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { assertVisitorRoute, requestPath } from './auth-security';
import { OperationLogsService } from '../operation-logs/operation-logs.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(@Optional() private readonly audit?: OperationLogsService) { super(); }
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const path = requestPath(request);
    if ((request.method === 'POST' && path === '/api/auth/login') || (request.method === 'GET' && ['/api/health', '/api/health/live', '/api/health/ready'].includes(path))) return true;
    const managed = path.startsWith('/api/admin/') || path === '/api/admin' || path.startsWith('/api/platform-benchmarks');
    try {
    await super.canActivate(context);
    if (managed && request.user.role !== 'admin') throw new ForbiddenException('Administrator required.');
    if (request.user.mustChangePassword && !['/api/auth/me', '/api/auth/change-password', '/api/auth/logout', '/api/auth/logout-all'].includes(path)) throw new ForbiddenException('Password change required.');
    if (request.user.role === 'visitor') assertVisitorRoute(request);
    return true;
    } catch (error) {
      if (managed) await this.audit?.create({ userId: request.user?.id || null, actionType: 'management_access_denied', targetType: 'management_route', targetId: path.startsWith('/api/platform-benchmarks') ? 'platform_benchmarks' : path.startsWith('/api/admin/operations') ? 'admin_operations' : 'admin_accounts', result: 'denied', comment: 'Management access rejected.' }).catch(() => undefined);
      throw error;
    }
  }
}
