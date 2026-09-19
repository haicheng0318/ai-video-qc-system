import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './modules/prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: PrismaService) {}
  @Get('live') live() { return { status: 'alive' }; }
  @Get('ready') async ready() {
    try { await this.db.$queryRaw`SELECT 1`; return { status: 'ready' }; }
    catch { throw new ServiceUnavailableException('Not ready.'); }
  }
  @Get()
  health() {
    return {
      status: 'ok',
      service: 'ai-video-qc-api',
      timestamp: new Date().toISOString(),
    };
  }
}
