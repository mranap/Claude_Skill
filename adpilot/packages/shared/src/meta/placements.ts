/**
 * Manual placement options (targeting.publisher_platforms / *_positions / device_platforms) valid in
 * Marketing API v26.0. "Advantage+ placements" (automatic) means omitting all placement fields.
 *
 * Not offered because Meta removed them:
 *  - Messenger: `messenger_home` (all versions since 2025-11-11), `sponsored_messages` (creation removed in
 *    v20.0), Messenger Stories `story` (silently removed in v26.0, all versions from 2026-10-27) — no
 *    Messenger placement can be selected for new ads any more;
 *  - Facebook `video_feeds` (error since v24.0), Instagram Explore feed `explore` (v26.0).
 * Dependency rules between placements are enforced by `placementIssues()` below.
 */
export const PUBLISHER_PLATFORMS = ['facebook', 'instagram', 'audience_network', 'threads'] as const;
export type PublisherPlatform = (typeof PUBLISHER_PLATFORMS)[number];

export const FACEBOOK_POSITIONS = [
  'feed',
  'profile_feed',
  'marketplace',
  'right_hand_column',
  'story',
  'facebook_reels',
  'instream_video',
  'search',
] as const;
export const INSTAGRAM_POSITIONS = [
  'stream',
  'profile_feed',
  'story',
  'reels',
  'explore_home',
  'ig_search',
  'profile_reels',
] as const;
export const AUDIENCE_NETWORK_POSITIONS = ['classic', 'rewarded_video'] as const;
export const THREADS_POSITIONS = ['threads_stream'] as const;
export const DEVICE_PLATFORMS = ['mobile', 'desktop'] as const;

export const PLACEMENT_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  audience_network: 'Audience Network',
  threads: 'Threads',
  'facebook:feed': 'Facebook Feed',
  'facebook:profile_feed': 'Facebook profile feed',
  'facebook:marketplace': 'Facebook Marketplace',
  'facebook:right_hand_column': 'Facebook right column',
  'facebook:story': 'Facebook Stories',
  'facebook:facebook_reels': 'Facebook Reels',
  'facebook:instream_video': 'Facebook in-stream videos',
  'facebook:search': 'Facebook search results',
  'instagram:stream': 'Instagram Feed',
  'instagram:profile_feed': 'Instagram profile feed',
  'instagram:story': 'Instagram Stories',
  'instagram:reels': 'Instagram Reels',
  'instagram:explore_home': 'Instagram Explore home',
  'instagram:ig_search': 'Instagram search results',
  'instagram:profile_reels': 'Instagram profile reels',
  'audience_network:classic': 'Audience Network native, banner & interstitial',
  'audience_network:rewarded_video': 'Audience Network rewarded videos',
  'threads:threads_stream': 'Threads feed',
  mobile: 'Mobile',
  desktop: 'Desktop',
};

export interface ManualPlacements {
  publisherPlatforms: readonly string[];
  facebookPositions: readonly string[];
  instagramPositions: readonly string[];
  audienceNetworkPositions: readonly string[];
  threadsPositions: readonly string[];
  devicePlatforms: readonly string[];
}

/**
 * Combination rules from Meta's placement targeting reference ("Limitations"). Returns human readable
 * problems keyed by field; an empty position list means "all positions of that platform".
 */
export function placementIssues(
  p: ManualPlacements,
): { path: string; message: string; severity: 'error' | 'warning' }[] {
  const out: { path: string; message: string; severity: 'error' | 'warning' }[] = [];
  const has = (platform: string) => p.publisherPlatforms.includes(platform);
  const fb = (pos: string) =>
    has('facebook') && (p.facebookPositions.length === 0 || p.facebookPositions.includes(pos));
  const ig = (pos: string) =>
    has('instagram') && (p.instagramPositions.length === 0 || p.instagramPositions.includes(pos));
  const mobileAllowed = p.devicePlatforms.length === 0 || p.devicePlatforms.includes('mobile');

  if (p.publisherPlatforms.length === 1 && has('audience_network')) {
    out.push({
      path: 'publisherPlatforms',
      message: 'Audience Network cannot be the only platform',
      severity: 'error',
    });
  }
  if (has('threads') && !ig('stream')) {
    out.push({
      path: 'threadsPositions',
      message: 'The Threads feed requires the Instagram feed placement as well',
      severity: 'error',
    });
  }
  if (
    has('facebook') &&
    p.facebookPositions.includes('story') &&
    (!(fb('feed') || ig('story')) || !mobileAllowed)
  ) {
    out.push({
      path: 'facebookPositions',
      message: 'Facebook Stories require Facebook Feed or Instagram Stories, on mobile devices',
      severity: 'error',
    });
  }
  const needFeed = p.facebookPositions.filter((pos) =>
    ['marketplace', 'search', 'profile_feed'].includes(pos),
  );
  if (needFeed.length && !p.facebookPositions.includes('feed')) {
    out.push({
      path: 'facebookPositions',
      message: `${needFeed.join(', ')} can only be used together with Facebook Feed`,
      severity: 'error',
    });
  }
  if (
    p.publisherPlatforms.length === 1 &&
    has('instagram') &&
    p.devicePlatforms.length === 1 &&
    p.devicePlatforms[0] === 'desktop'
  ) {
    out.push({
      path: 'devicePlatforms',
      message: 'Instagram placements are not available on desktop only',
      severity: 'error',
    });
  }
  if (p.facebookPositions.includes('right_hand_column')) {
    out.push({
      path: 'facebookPositions',
      message:
        'The right column is only used for website traffic/sales objectives with image, video or carousel ads',
      severity: 'warning',
    });
  }
  return out;
}
