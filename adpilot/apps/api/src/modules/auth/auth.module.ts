import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AccountController } from './account.controller';
import { AuthService } from './auth.service';
import { AuthCacheService } from './auth-cache.service';
import { CsrfService } from './csrf.service';
import { SessionService } from './session.service';
import { TwoFactorService } from './two-factor.service';

@Global()
@Module({
  controllers: [AuthController, AccountController],
  providers: [AuthService, AuthCacheService, CsrfService, SessionService, TwoFactorService],
  exports: [AuthService, AuthCacheService, CsrfService, SessionService],
})
export class AuthModule {}
