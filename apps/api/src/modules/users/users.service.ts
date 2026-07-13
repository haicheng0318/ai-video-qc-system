import { Injectable } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findActiveByAccount(account: string) {
    return this.prisma.user.findFirst({
      where: {
        account,
        status: UserStatus.active,
      },
    });
  }

  findActiveById(id: string) {
    return this.prisma.user.findFirst({
      where: {
        id,
        status: UserStatus.active,
      },
    });
  }
}
