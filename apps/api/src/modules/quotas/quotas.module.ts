import { Global, Module } from '@nestjs/common';
import { QuotasService } from './quotas.service';
import { UploadTicketMaintenance } from './upload-ticket-maintenance';
import { StorageModule } from '../storage/storage.module';
@Global()
@Module({ imports: [StorageModule], providers: [QuotasService, UploadTicketMaintenance], exports: [QuotasService, UploadTicketMaintenance] })
export class QuotasModule {}
