import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { OperationLogAction } from '../operation-logs/operation-log-actions';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly operationLogsService: OperationLogsService,
  ) {}

  async login(dto: LoginDto, requestMeta: { ipAddress?: string; userAgent?: string }) {
    const user = await this.usersService.findActiveByAccount(dto.account);
    const passwordMatches = user ? await bcrypt.compare(dto.password, user.passwordHash) : false;

    if (!user || !passwordMatches) {
      await this.operationLogsService.create({
        actionType: OperationLogAction.LoginFailed,
        result: 'failure',
        comment: `Login failed for account: ${dto.account}`,
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      });
      throw new UnauthorizedException('Invalid account or password.');
    }

    await this.operationLogsService.create({
      userId: user.id,
      actionType: OperationLogAction.LoginSuccess,
      result: 'success',
      comment: 'User logged in successfully.',
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    const payload = {
      sub: user.id,
      account: user.account,
      role: user.role,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: {
        id: user.id,
        name: user.name,
        account: user.account,
        role: user.role,
        department: user.department,
      },
    };
  }
}
