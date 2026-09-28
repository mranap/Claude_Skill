import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  confirmEmailSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaVerifySchema,
  resetPasswordSchema,
} from '@adpilot/shared';
import { z } from 'zod';
import { AppConfig } from '../../config/app-config';
import { AllowPendingPasswordChange, Public, SkipCsrf } from '../../common/decorators/auth.decorators';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { clientInfo } from '../../common/http/client-info';
import { AppError } from '../../common/errors/app-error';
import { AuthService } from './auth.service';
import { CsrfService } from './csrf.service';
import { IssuedSession } from './session.service';
import { clearAuthCookies, cookieNames, setAccessCookie, setCsrfCookie, setRefreshCookie } from './cookies';
import type { AuthUser } from './auth.types';

type AuthedRequest = Request & { user?: AuthUser };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly csrf: CsrfService,
    private readonly config: AppConfig,
  ) {}

  /** Issues the CSRF cookie (called by the web app on load). */
  @Public()
  @Get('csrf')
  issueCsrf(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const token = this.csrf.issue(req.user?.sessionId ?? null);
    setCsrfCookie(res, this.config, token);
    return { csrfToken: token };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(zod(loginSchema)) body: z.infer<typeof loginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { response, session } = await this.auth.login(body.email, body.password, clientInfo(req));
    if (session) this.applySession(res, session);
    return response;
  }

  @Public()
  @Post('login/2fa')
  @HttpCode(200)
  async loginMfa(
    @Body(zod(mfaVerifySchema)) body: z.infer<typeof mfaVerifySchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, session } = await this.auth.verifyMfa(body.ticket, body.code, clientInfo(req));
    this.applySession(res, session);
    return { status: 'OK', user };
  }

  @Public()
  @SkipCsrf()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string> | undefined)?.[cookieNames(this.config).refresh];
    try {
      const session = await this.auth.refresh(token, clientInfo(req));
      this.applySession(res, session);
      return { ok: true };
    } catch (err) {
      clearAuthCookies(res, this.config);
      throw err;
    }
  }

  @Public()
  @SkipCsrf()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string> | undefined)?.[cookieNames(this.config).refresh];
    await this.auth.logout(req.user, token);
    clearAuthCookies(res, this.config);
    setCsrfCookie(res, this.config, this.csrf.issue(null));
    return { ok: true };
  }

  /**
   * Session probe for the web app: never answers 401. `refreshable` tells whether a refresh cookie is present
   * (the access token may simply have expired — then POST /auth/refresh restores the session).
   */
  @Public()
  @Get('session')
  async session(@Req() req: AuthedRequest) {
    if (req.user) return { authenticated: true, user: await this.auth.me(req.user.id) };
    const refresh = (req.cookies as Record<string, string> | undefined)?.[cookieNames(this.config).refresh];
    return { authenticated: false, refreshable: !!refresh };
  }

  @AllowPendingPasswordChange()
  @Get('me')
  async me(@Req() req: AuthedRequest) {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'Please sign in to continue');
    return this.auth.me(req.user.id);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(202)
  async forgot(@Body(zod(forgotPasswordSchema)) body: z.infer<typeof forgotPasswordSchema>, @Req() req: Request) {
    await this.auth.forgotPassword(body.email, clientInfo(req));
    return { ok: true, message: 'If an account exists for this e-mail, a reset link has been sent.' };
  }

  @Public()
  @Get('password/reset/validate')
  async validateReset(@Query('token') token: string) {
    if (typeof token !== 'string' || token.length < 20) return { valid: false };
    return this.auth.validateResetToken(token);
  }

  @Public()
  @Post('password/reset')
  @HttpCode(200)
  async reset(@Body(zod(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>, @Req() req: Request) {
    await this.auth.resetPassword(body.token, body.password, clientInfo(req));
    return { ok: true };
  }

  @Public()
  @Post('email/confirm')
  @HttpCode(200)
  async confirmEmail(@Body(zod(confirmEmailSchema)) body: z.infer<typeof confirmEmailSchema>) {
    await this.auth.confirmEmailChange(body.token);
    return { ok: true };
  }

  private applySession(res: Response, session: IssuedSession): void {
    setAccessCookie(res, this.config, session.accessToken);
    if (session.refreshToken) setRefreshCookie(res, this.config, session.refreshToken, session.expiresAt);
    setCsrfCookie(res, this.config, this.csrf.issue(session.sessionId));
  }
}
