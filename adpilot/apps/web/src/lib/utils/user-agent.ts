export type DeviceKind = 'desktop' | 'mobile' | 'tablet' | 'unknown';

export interface DeviceInfo {
  browser: string;
  os: string;
  kind: DeviceKind;
  /** "Chrome on macOS" */
  label: string;
}

function detectBrowser(ua: string): string {
  if (/HeadlessChrome/i.test(ua)) return 'Headless Chrome';
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/YaBrowser\//.test(ua)) return 'Yandex Browser';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'Safari';
  if (/curl\//i.test(ua)) return 'curl';
  if (/node|undici|axios/i.test(ua)) return 'API client';
  return 'Unknown browser';
}

function detectOs(ua: string): string {
  if (/iPhone|iPod/.test(ua)) return 'iOS';
  if (/iPad/.test(ua)) return 'iPadOS';
  if (/Android/.test(ua)) return 'Android';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Windows NT/.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown OS';
}

function detectKind(ua: string): DeviceKind {
  if (/iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/.test(ua)) return 'mobile';
  if (/Windows|Macintosh|Linux|CrOS/.test(ua)) return 'desktop';
  return 'unknown';
}

/** Lightweight, dependency-free User-Agent summary for session and login lists. */
export function describeUserAgent(ua: string | null | undefined): DeviceInfo {
  if (!ua) return { browser: 'Unknown browser', os: 'Unknown OS', kind: 'unknown', label: 'Unknown device' };
  const browser = detectBrowser(ua);
  const os = detectOs(ua);
  const kind = detectKind(ua);
  const label = os === 'Unknown OS' ? browser : `${browser} on ${os}`;
  return { browser, os, kind, label };
}
