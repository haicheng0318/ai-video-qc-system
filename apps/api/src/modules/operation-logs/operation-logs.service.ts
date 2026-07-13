import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type CreateOperationLogInput = {
  userId?: string | null;
  videoId?: string | null;
  actionType: string;
  beforeValue?: Prisma.InputJsonValue | null;
  afterValue?: Prisma.InputJsonValue | null;
  comment?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

@Injectable()
export class OperationLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateOperationLogInput) {
    return this.prisma.operationLog.create({
      data: {
        userId: input.userId ?? null,
        videoId: input.videoId ?? null,
        actionType: input.actionType,
        beforeValue: input.beforeValue ?? undefined,
        afterValue: input.afterValue ?? undefined,
        comment: input.comment ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  }
}
