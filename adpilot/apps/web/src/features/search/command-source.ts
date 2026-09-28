import {
  Briefcase,
  FilePen,
  Image as ImageIcon,
  LayoutTemplate,
  Layers,
  Megaphone,
  Plug,
  RectangleHorizontal,
  type LucideIcon,
} from 'lucide-react';
import type { CommandEntry, CommandSource } from '@/components/layout/command-menu';
import { api } from '@/lib/api/client';
import { safeHref } from '@/lib/utils/strings';

type SearchHitType =
  'AD_ACCOUNT' | 'CAMPAIGN' | 'ADSET' | 'AD' | 'TEMPLATE' | 'DRAFT' | 'CREATIVE' | 'META_PROFILE';

/** GET /search */
interface SearchResponse {
  query: string;
  hits: { type: SearchHitType; id: string; title: string; subtitle?: string; link: string }[];
}

const GROUPS: Record<SearchHitType, { group: string; icon: LucideIcon }> = {
  AD_ACCOUNT: { group: 'Ad accounts', icon: Briefcase },
  CAMPAIGN: { group: 'Campaigns', icon: Megaphone },
  ADSET: { group: 'Ad sets', icon: Layers },
  AD: { group: 'Ads', icon: RectangleHorizontal },
  TEMPLATE: { group: 'Templates', icon: LayoutTemplate },
  DRAFT: { group: 'Launch drafts', icon: FilePen },
  CREATIVE: { group: 'Creatives', icon: ImageIcon },
  META_PROFILE: { group: 'Meta profiles', icon: Plug },
};

/**
 * Command-palette source for the global search: the user's own ad accounts, campaigns, ad sets, ads,
 * templates, drafts, creatives and Meta profiles (names or Meta ids), limited by the API to what the
 * user's role can read.
 */
export const globalSearchSource: CommandSource = {
  id: 'global-search',
  heading: 'Results',
  minQueryLength: 2,
  search: async (query, signal) => {
    const res = await api.get<SearchResponse>('/search', { q: query }, { signal });
    return res.hits.flatMap<CommandEntry>((hit) => {
      const target = safeHref(hit.link);
      if (!target || target.external) return [];
      const meta = GROUPS[hit.type] ?? { group: 'Results', icon: Briefcase };
      return [
        {
          id: `search:${hit.type}:${hit.id}`,
          label: hit.title,
          group: meta.group,
          icon: meta.icon,
          href: target.href,
          hint: hit.subtitle,
        },
      ];
    });
  },
};
