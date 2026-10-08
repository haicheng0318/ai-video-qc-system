import { Global, Module } from '@nestjs/common';
import { VideoStorageService } from './video-storage.service';

@Global()
@Module({
  providers: [VideoStorageService],
  exports: [VideoStorageService],
})
export class StorageModule {}
