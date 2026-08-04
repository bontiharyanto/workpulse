import { Module } from '@nestjs/common';

import { S3StorageProvider } from './s3-storage.provider';
import { STORAGE_PROVIDER } from './storage.provider';

@Module({
  providers: [
    S3StorageProvider,
    { provide: STORAGE_PROVIDER, useExisting: S3StorageProvider },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
