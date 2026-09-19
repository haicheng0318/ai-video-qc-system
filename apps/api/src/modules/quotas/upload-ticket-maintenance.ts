import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VideoStorageService } from '../storage/video-storage.service';
import { QuotasService } from './quotas.service';

@Injectable()
export class UploadTicketMaintenance {
  constructor(private readonly prisma: PrismaService, private readonly quotas: QuotasService, private readonly storage: VideoStorageService) {}
  async sweep() {
    // Grace absorbs timestamp granularity and queued in-flight PUTs. No cleanup while a signature is valid.
    const cutoff = new Date(Date.now() - 60000);
    const candidates = await this.prisma.uploadTicket.findMany({ where: { expiresAt: { lte: cutoff }, cleanedAt: null }, take: 50, orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }] });
    for (const candidate of candidates) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await this.quotas.lock(tx, candidate.userId);
          const ticket = await tx.uploadTicket.findUniqueOrThrow({ where: { id: candidate.id } });
          if (ticket.cleanedAt || ticket.expiresAt > cutoff) return;
          if (ticket.status !== 'confirmed') {
            await this.quotas.release(tx, ticket.userId, 'upload_count', `upload:${ticket.id}`);
            await this.quotas.release(tx, ticket.userId, 'storage_bytes', `upload:${ticket.id}`);
          }
          if (ticket.objectPath.startsWith('cos://') && !await tx.video.findFirst({ where: { filePath: ticket.objectPath } })) await this.storage.deleteStoredFile(ticket.objectPath);
          if (ticket.status !== 'confirmed' && ticket.finalObjectPath && !await tx.video.findFirst({ where: { filePath: ticket.finalObjectPath } })) await this.storage.deleteStoredFile(ticket.finalObjectPath);
          await tx.uploadTicket.update({ where: { id: ticket.id }, data: { status: ticket.status === 'confirmed' ? 'confirmed' : 'expired', cleanedAt: new Date(), cleanupError: null, cleanupAttempts: { increment: 1 } } });
          await tx.operationLog.create({ data: { userId: ticket.userId, targetType: 'upload_ticket', targetId: ticket.id, actionType: 'upload_ticket_cleaned', result: 'success' } });
        }, { timeout: 30000 });
      } catch {
        // Persist only a normalized diagnostic: cloud errors can contain signed URLs or credentials.
        await this.prisma.uploadTicket.updateMany({ where: { id: candidate.id, cleanedAt: null }, data: { cleanupError: 'storage_cleanup_failed', cleanupAttempts: { increment: 1 } } });
      }
    }
  }
}
