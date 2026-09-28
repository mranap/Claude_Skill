import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { SmtpService } from './smtp.service';

@Global()
@Module({
  providers: [MailService, SmtpService],
  exports: [MailService, SmtpService],
})
export class MailModule {}
