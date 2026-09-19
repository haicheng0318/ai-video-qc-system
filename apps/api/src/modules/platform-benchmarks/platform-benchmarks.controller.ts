import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../permissions/roles.decorator';
import { RolesGuard } from '../permissions/roles.guard';
import { SavePlatformBenchmarkDto } from './dto/save-platform-benchmark.dto';
import { PlatformBenchmarksService } from './platform-benchmarks.service';

@Controller('platform-benchmarks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin)
export class PlatformBenchmarksController {
  constructor(private readonly service: PlatformBenchmarksService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(
    @Body() body: SavePlatformBenchmarkDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.service.create(body, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Put(':id')
  replace(
    @Param('id') id: string,
    @Body() body: SavePlatformBenchmarkDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.service.replace(id, body, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
