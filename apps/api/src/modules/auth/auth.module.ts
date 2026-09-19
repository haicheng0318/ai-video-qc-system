import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { getJwtConfig, parseJwtExpiresIn } from '../../env';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { APP_GUARD } from '@nestjs/core';
import { CsrfGuard } from './auth-security';
import { JwtAuthGuard } from './jwt-auth.guard';
import { QuotasModule } from '../quotas/quotas.module';

@Module({
  imports: [
    UsersModule,
    QuotasModule,
    PassportModule,
    JwtModule.register({
      secret: getJwtConfig().jwtSecret,
      signOptions: {
        expiresIn: parseJwtExpiresIn(getJwtConfig().jwtExpiresIn),
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, { provide: APP_GUARD, useClass: CsrfGuard }, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
