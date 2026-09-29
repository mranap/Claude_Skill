/**
 * Hard limits for creative files accepted by Meta ads (Marketing API v26.0 / Meta Ads Guide).
 * Admin-configurable limits (Super Admin → File limits) can only be stricter than these values,
 * so the platform never accepts a file Meta would reject for format or size reasons.
 *
 * Sources: Meta Ads Guide (image & video specs) and the AdImage / AdVideo API references.
 * Verified against the official Business SDK v26.0 object definitions; see docs/META_API.md.
 */
export const META_MEDIA_LIMITS = {
  image: {
    /** Meta Ads Guide: "Maximum file size: 30MB". */
    maxSizeMb: 30,
    extensions: ['jpg', 'jpeg', 'png'] as const,
    mimeTypes: ['image/jpeg', 'image/png'] as const,
    /** Smallest width/height accepted by the feed placements. */
    minWidth: 600,
    minHeight: 600,
  },
  video: {
    /** Meta Ads Guide: "Maximum file size: 4GB". */
    maxSizeMb: 4096,
    extensions: ['mp4', 'mov'] as const,
    mimeTypes: ['video/mp4', 'video/quicktime'] as const,
    minDurationSec: 1,
    /** Feed placements accept up to 241 minutes. */
    maxDurationSec: 241 * 60,
    minWidth: 120,
    minHeight: 120,
    recommendedCodecs: ['h264', 'hevc', 'vp8', 'vp9'] as const,
  },
} as const;

export type ImageExtension = (typeof META_MEDIA_LIMITS.image.extensions)[number];
export type VideoExtension = (typeof META_MEDIA_LIMITS.video.extensions)[number];

/** Aspect ratios Meta recommends per placement group (used for UI hints, not hard validation). */
export const RECOMMENDED_ASPECT_RATIOS = [
  { ratio: '1:1', value: 1, use: 'Feeds' },
  { ratio: '4:5', value: 0.8, use: 'Feeds (mobile)' },
  { ratio: '9:16', value: 9 / 16, use: 'Stories, Reels' },
  { ratio: '16:9', value: 16 / 9, use: 'In-stream, landscape' },
  { ratio: '1.91:1', value: 1.91, use: 'Link ads, right column' },
] as const;

/** Returns a readable aspect ratio label ("9:16") or the decimal value when it is not a common ratio. */
export function describeAspectRatio(width: number, height: number): string {
  if (!width || !height) return '';
  const value = width / height;
  for (const r of RECOMMENDED_ASPECT_RATIOS) {
    if (Math.abs(r.value - value) < 0.02) return r.ratio;
  }
  return value.toFixed(2);
}
