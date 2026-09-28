import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';
import { HashingService } from './hashing.service';

@Global()
@Module({
  providers: [EncryptionService, HashingService],
  exports: [EncryptionService, HashingService],
})
export class CryptoModule {}
