import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DashboardService } from './dashboard.service';
import { DashboardBreakdownQueryDto, DashboardQueryDto, DashboardTrendQueryDto } from './dto/dashboard-query.dto';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('summary')
  summary(@Query() query: DashboardQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.summary(query, user);
  }

  @Get('trend')
  trend(@Query() query: DashboardTrendQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.trend(query, user);
  }

  @Get('breakdown')
  breakdown(@Query() query: DashboardBreakdownQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.breakdown(query, user);
  }
}
