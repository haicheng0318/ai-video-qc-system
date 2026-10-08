import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { catchError } from 'rxjs';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { requestPath } from './auth-security';

// Guards audit entry denials. This boundary covers identity changes discovered
// inside a transaction, after guards have already allowed the request.
@Injectable()
export class ManagementDenialInterceptor implements NestInterceptor {
  constructor(private readonly audit: OperationLogsService) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest(); const path = requestPath(request);
    const managed = path.startsWith('/api/admin/') || path === '/api/admin' || path.startsWith('/api/platform-benchmarks');
    const auditErrors = catchError(async error => {
      if (managed && error instanceof HttpException && [401, 403].includes(error.getStatus())) {
        await this.audit.create({ userId: request.user?.id || null, actionType: 'management_access_denied', targetType: 'management_route', targetId: path.startsWith('/api/platform-benchmarks') ? 'platform_benchmarks' : path.startsWith('/api/admin/operations') ? 'admin_operations' : 'admin_accounts', result: 'denied', comment: 'Management identity rejected during operation.' }).catch(() => undefined);
      }
      throw error;
    });
    // Nest and this workspace resolve separate RxJS copies. Their public pipe
    // contract is compatible; only private Subscriber types differ nominally.
    type NestObservable = ReturnType<CallHandler['handle']>;
    return next.handle().pipe(auditErrors as unknown as (source: NestObservable) => NestObservable);
  }
}
