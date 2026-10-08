import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Request, Response } from 'express';
import { localizeHttpMessage } from './localize-http-message';

@Catch(HttpException)
export class LocalizedHttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const status = exception.getStatus();
    const original = exception.getResponse();
    const payload = typeof original === 'string'
      ? { statusCode: status, message: original }
      : { ...(original as Record<string, unknown>), statusCode: status };
    const message = payload.message;
    const localized = Array.isArray(message)
      ? message.map((item) => localizeHttpMessage(item, status))
      : localizeHttpMessage(message, status);

    response.status(status).json({
      ...payload,
      message: localized,
      error: '请求处理失败',
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
