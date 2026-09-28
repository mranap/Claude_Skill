import { Injectable } from '@nestjs/common';
import { Env, loadEnv } from './env';

/** Typed, validated configuration. Inject this instead of reading `process.env` directly. */
@Injectable()
export class AppConfig {
  readonly env: Env;

  constructor() {
    this.env = loadEnv();
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }

  get appUrl(): string {
    return this.env.APP_URL.replace(/\/+$/, '');
  }

  get corsOrigins(): string[] {
    const extra = this.env.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return [this.appUrl, ...extra];
  }

  get meta() {
    return {
      version: this.env.META_GRAPH_API_VERSION,
      baseUrl: this.env.META_GRAPH_BASE_URL.replace(/\/+$/, ''),
      videoBaseUrl: this.env.META_GRAPH_VIDEO_BASE_URL.replace(/\/+$/, ''),
      timeoutMs: this.env.META_REQUEST_TIMEOUT_MS,
    };
  }
}
