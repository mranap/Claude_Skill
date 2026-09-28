import { Injectable } from '@nestjs/common';
import { HashingService } from '../../infra/crypto/hashing.service';

/**
 * Double-submit CSRF tokens bound to the session: `<nonce>.<hmac(nonce + sessionId)>`.
 * The token is stored in a non-HttpOnly SameSite=Strict cookie and must be echoed in the `X-CSRF-Token`
 * header of every state-changing request. Binding to the session id prevents cookie-tossing attacks;
 * anonymous requests (login, password reset) use the `anon` binding.
 */
@Injectable()
export class CsrfService {
  constructor(private readonly hashing: HashingService) {}

  issue(sessionId: string | null): string {
    const nonce = this.hashing.randomToken(18);
    return `${nonce}.${this.sign(nonce, sessionId)}`;
  }

  /**
   * @param allowAnonymous accept a token issued before login even when a session exists. Only for public
   *   endpoints (login, 2FA step, password reset) — they never act on the current session. Every
   *   authenticated endpoint requires a token bound to the requesting session.
   */
  verify(
    cookieToken: string | undefined,
    headerToken: string | undefined,
    sessionId: string | null,
    allowAnonymous = false,
  ): boolean {
    if (!cookieToken || !headerToken || !this.hashing.safeEqual(cookieToken, headerToken)) return false;
    const [nonce, sig] = cookieToken.split('.');
    if (!nonce || !sig) return false;
    if (this.hashing.safeEqual(sig, this.sign(nonce, sessionId))) return true;
    return allowAnonymous && sessionId !== null && this.hashing.safeEqual(sig, this.sign(nonce, null));
  }

  private sign(nonce: string, sessionId: string | null): string {
    return this.hashing.hmac(`${nonce}|${sessionId ?? 'anon'}`, 'csrf');
  }
}
