/**
 * Manual placement options (targeting.publisher_platforms / *_positions / device_platforms) valid in
 * Marketing API v26.0. Removed in v26.0 (and for all versions from 2026-10-27): Instagram Explore feed
 * (`explore`) and Messenger Stories (`messenger_positions: story`) — they are not offered here.
 * "Advantage+ placements" (automatic) means omitting all placement fields.
 */
export const PUBLISHER_PLATFORMS = ['facebook', 'instagram', 'audience_network', 'messenger', 'threads'] as const;
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
export const INSTAGRAM_POSITIONS = ['stream', 'profile_feed', 'story', 'reels', 'explore_home', 'ig_search', 'profile_reels'] as const;
export const AUDIENCE_NETWORK_POSITIONS = ['classic', 'rewarded_video'] as const;
export const MESSENGER_POSITIONS = ['messenger_home', 'sponsored_messages'] as const;
export const THREADS_POSITIONS = ['threads_stream'] as const;
export const DEVICE_PLATFORMS = ['mobile', 'desktop'] as const;

export const PLACEMENT_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  audience_network: 'Audience Network',
  messenger: 'Messenger',
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
  'messenger:messenger_home': 'Messenger inbox',
  'messenger:sponsored_messages': 'Messenger sponsored messages',
  'threads:threads_stream': 'Threads feed',
  mobile: 'Mobile',
  desktop: 'Desktop',
};
