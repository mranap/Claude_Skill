/**
 * Supported campaign configurations for Marketing API v26.0 (Outcome-Driven Ad Experiences objectives).
 *
 * Each objective lists the conversion locations (ad set `destination_type`) the platform supports and, for
 * each, the valid `optimization_goal`s with their allowed `billing_event`s and `promoted_object`
 * requirements. The UI only offers these combinations and the backend validates every launch against this
 * table before anything is sent to Meta. Combinations Meta supports but the platform does not implement
 * (app promotion, catalog sales, messaging/calls, events) are intentionally absent — see docs/META_API.md.
 */

export const OBJECTIVES = [
  'OUTCOME_LEADS',
  'OUTCOME_SALES',
  'OUTCOME_TRAFFIC',
  'OUTCOME_AWARENESS',
  'OUTCOME_ENGAGEMENT',
] as const;
export type Objective = (typeof OBJECTIVES)[number];

export const DESTINATIONS = ['WEBSITE', 'ON_AD', 'ON_POST', 'ON_VIDEO', 'ON_PAGE', 'NONE'] as const;
export type Destination = (typeof DESTINATIONS)[number];

export const OPTIMIZATION_GOALS = [
  'OFFSITE_CONVERSIONS',
  'VALUE',
  'LANDING_PAGE_VIEWS',
  'LINK_CLICKS',
  'IMPRESSIONS',
  'REACH',
  'LEAD_GENERATION',
  'QUALITY_LEAD',
  'AD_RECALL_LIFT',
  'THRUPLAY',
  'POST_ENGAGEMENT',
  'PAGE_LIKES',
] as const;
export type OptimizationGoal = (typeof OPTIMIZATION_GOALS)[number];

export const BILLING_EVENTS = ['IMPRESSIONS', 'LINK_CLICKS', 'THRUPLAY'] as const;
export type BillingEvent = (typeof BILLING_EVENTS)[number];

/** Conversion events usable with a Pixel/dataset (AdPromotedObject.custom_event_type). */
export const CONVERSION_EVENTS = [
  'LEAD',
  'COMPLETE_REGISTRATION',
  'CONTACT',
  'SUBMIT_APPLICATION',
  'SCHEDULE',
  'START_TRIAL',
  'SUBSCRIBE',
  'PURCHASE',
  'ADD_TO_CART',
  'INITIATED_CHECKOUT',
  'ADD_PAYMENT_INFO',
  'ADD_TO_WISHLIST',
  'CONTENT_VIEW',
  'SEARCH',
  'FIND_LOCATION',
  'DONATE',
  'CUSTOMIZE_PRODUCT',
  'OTHER',
] as const;
export type ConversionEvent = (typeof CONVERSION_EVENTS)[number];

export const CONVERSION_EVENT_LABELS: Record<ConversionEvent, string> = {
  LEAD: 'Lead',
  COMPLETE_REGISTRATION: 'Complete registration',
  CONTACT: 'Contact',
  SUBMIT_APPLICATION: 'Submit application',
  SCHEDULE: 'Schedule',
  START_TRIAL: 'Start trial',
  SUBSCRIBE: 'Subscribe',
  PURCHASE: 'Purchase',
  ADD_TO_CART: 'Add to cart',
  INITIATED_CHECKOUT: 'Initiate checkout',
  ADD_PAYMENT_INFO: 'Add payment info',
  ADD_TO_WISHLIST: 'Add to wishlist',
  CONTENT_VIEW: 'View content',
  SEARCH: 'Search',
  FIND_LOCATION: 'Find location',
  DONATE: 'Donate',
  CUSTOMIZE_PRODUCT: 'Customize product',
  OTHER: 'Other',
};

export type PromotedObjectRequirement = 'NONE' | 'PIXEL_EVENT' | 'PAGE';

export interface GoalRule {
  goal: OptimizationGoal;
  label: string;
  billingEvents: BillingEvent[];
  promotedObject: PromotedObjectRequirement;
  /** Events allowed for PIXEL_EVENT goals (empty = any CONVERSION_EVENTS). */
  events?: ConversionEvent[];
  /** Creative requirement (e.g. Instant Form id for lead forms). */
  requiresLeadForm?: boolean;
  requiresVideo?: boolean;
}

export interface DestinationRule {
  destination: Destination;
  label: string;
  description: string;
  goals: GoalRule[];
}

export interface ObjectiveRule {
  objective: Objective;
  label: string;
  description: string;
  destinations: DestinationRule[];
}

const LEAD_EVENTS: ConversionEvent[] = ['LEAD', 'COMPLETE_REGISTRATION', 'CONTACT', 'SUBMIT_APPLICATION', 'SCHEDULE', 'START_TRIAL', 'SUBSCRIBE', 'OTHER'];
const SALES_EVENTS: ConversionEvent[] = ['PURCHASE', 'ADD_TO_CART', 'INITIATED_CHECKOUT', 'ADD_PAYMENT_INFO', 'ADD_TO_WISHLIST', 'CONTENT_VIEW', 'SUBSCRIBE', 'START_TRIAL', 'OTHER'];

const trafficGoals: GoalRule[] = [
  { goal: 'LANDING_PAGE_VIEWS', label: 'Landing page views', billingEvents: ['IMPRESSIONS'], promotedObject: 'NONE' },
  { goal: 'LINK_CLICKS', label: 'Link clicks', billingEvents: ['IMPRESSIONS', 'LINK_CLICKS'], promotedObject: 'NONE' },
  { goal: 'IMPRESSIONS', label: 'Impressions', billingEvents: ['IMPRESSIONS'], promotedObject: 'NONE' },
  { goal: 'REACH', label: 'Daily unique reach', billingEvents: ['IMPRESSIONS'], promotedObject: 'NONE' },
];

export const OBJECTIVE_RULES: ObjectiveRule[] = [
  {
    objective: 'OUTCOME_LEADS',
    label: 'Leads',
    description: 'Collect leads on your website or with an Instant Form.',
    destinations: [
      {
        destination: 'WEBSITE',
        label: 'Website',
        description: 'Leads are tracked with your Pixel / dataset.',
        goals: [
          { goal: 'OFFSITE_CONVERSIONS', label: 'Maximise number of conversions', billingEvents: ['IMPRESSIONS'], promotedObject: 'PIXEL_EVENT', events: LEAD_EVENTS },
          ...trafficGoals,
        ],
      },
      {
        destination: 'ON_AD',
        label: 'Instant form',
        description: 'People submit a Meta lead form without leaving Facebook/Instagram.',
        goals: [
          { goal: 'LEAD_GENERATION', label: 'Maximise number of leads', billingEvents: ['IMPRESSIONS'], promotedObject: 'PAGE', requiresLeadForm: true },
          { goal: 'QUALITY_LEAD', label: 'Maximise number of conversion leads', billingEvents: ['IMPRESSIONS'], promotedObject: 'PAGE', requiresLeadForm: true },
        ],
      },
    ],
  },
  {
    objective: 'OUTCOME_SALES',
    label: 'Sales',
    description: 'Find people likely to purchase on your website.',
    destinations: [
      {
        destination: 'WEBSITE',
        label: 'Website',
        description: 'Purchases and other conversions tracked with your Pixel / dataset.',
        goals: [
          { goal: 'OFFSITE_CONVERSIONS', label: 'Maximise number of conversions', billingEvents: ['IMPRESSIONS'], promotedObject: 'PIXEL_EVENT', events: SALES_EVENTS },
          { goal: 'VALUE', label: 'Maximise value of conversions', billingEvents: ['IMPRESSIONS'], promotedObject: 'PIXEL_EVENT', events: ['PURCHASE'] },
          ...trafficGoals,
        ],
      },
    ],
  },
  {
    objective: 'OUTCOME_TRAFFIC',
    label: 'Traffic',
    description: 'Send people to your website.',
    destinations: [{ destination: 'WEBSITE', label: 'Website', description: 'Clicks and landing page views.', goals: trafficGoals }],
  },
  {
    objective: 'OUTCOME_AWARENESS',
    label: 'Awareness',
    description: 'Show ads to as many people as possible or to those most likely to remember them.',
    destinations: [
      {
        destination: 'NONE',
        label: 'Not applicable',
        description: 'Awareness campaigns have no conversion location.',
        goals: [
          { goal: 'REACH', label: 'Reach', billingEvents: ['IMPRESSIONS'], promotedObject: 'PAGE' },
          { goal: 'IMPRESSIONS', label: 'Impressions', billingEvents: ['IMPRESSIONS'], promotedObject: 'PAGE' },
          { goal: 'AD_RECALL_LIFT', label: 'Ad recall lift', billingEvents: ['IMPRESSIONS'], promotedObject: 'PAGE' },
          { goal: 'THRUPLAY', label: 'ThruPlay (video views)', billingEvents: ['IMPRESSIONS', 'THRUPLAY'], promotedObject: 'PAGE', requiresVideo: true },
        ],
      },
    ],
  },
  {
    objective: 'OUTCOME_ENGAGEMENT',
    label: 'Engagement',
    description: 'Get more post engagement, video views or Page likes.',
    destinations: [
      {
        destination: 'ON_POST',
        label: 'On your ad',
        description: 'Reactions, comments and shares on the ad.',
        goals: [
          { goal: 'POST_ENGAGEMENT', label: 'Post engagement', billingEvents: ['IMPRESSIONS'], promotedObject: 'NONE' },
          { goal: 'IMPRESSIONS', label: 'Impressions', billingEvents: ['IMPRESSIONS'], promotedObject: 'NONE' },
          { goal: 'REACH', label: 'Daily unique reach', billingEvents: ['IMPRESSIONS'], promotedObject: 'NONE' },
        ],
      },
      {
        destination: 'ON_VIDEO',
        label: 'Video views',
        description: 'People who watch the video.',
        goals: [{ goal: 'THRUPLAY', label: 'ThruPlay', billingEvents: ['IMPRESSIONS', 'THRUPLAY'], promotedObject: 'NONE', requiresVideo: true }],
      },
      {
        destination: 'ON_PAGE',
        label: 'Facebook Page',
        description: 'Page likes.',
        goals: [{ goal: 'PAGE_LIKES', label: 'Page likes', billingEvents: ['IMPRESSIONS'], promotedObject: 'PAGE' }],
      },
      {
        destination: 'WEBSITE',
        label: 'Website',
        description: 'Engagement on your website tracked with your Pixel / dataset.',
        goals: [
          { goal: 'OFFSITE_CONVERSIONS', label: 'Maximise number of conversions', billingEvents: ['IMPRESSIONS'], promotedObject: 'PIXEL_EVENT' },
          { goal: 'LANDING_PAGE_VIEWS', label: 'Landing page views', billingEvents: ['IMPRESSIONS'], promotedObject: 'NONE' },
          { goal: 'LINK_CLICKS', label: 'Link clicks', billingEvents: ['IMPRESSIONS', 'LINK_CLICKS'], promotedObject: 'NONE' },
        ],
      },
    ],
  },
];

export function objectiveRule(objective: string): ObjectiveRule | undefined {
  return OBJECTIVE_RULES.find((o) => o.objective === objective);
}

export function goalRule(objective: string, destination: string, goal: string): GoalRule | undefined {
  return objectiveRule(objective)
    ?.destinations.find((d) => d.destination === destination)
    ?.goals.find((g) => g.goal === goal);
}

/** Destinations whose ads send people to a URL (link required in the creative). */
export function destinationNeedsLink(destination: Destination): boolean {
  return destination === 'WEBSITE' || destination === 'NONE' || destination === 'ON_POST' || destination === 'ON_VIDEO';
}

export const BID_STRATEGIES = ['LOWEST_COST_WITHOUT_CAP', 'COST_CAP', 'LOWEST_COST_WITH_BID_CAP', 'LOWEST_COST_WITH_MIN_ROAS'] as const;
export type BidStrategy = (typeof BID_STRATEGIES)[number];
export const BID_STRATEGY_LABELS: Record<BidStrategy, { label: string; description: string }> = {
  LOWEST_COST_WITHOUT_CAP: { label: 'Highest volume', description: 'Get the most results for your budget (no cost control).' },
  COST_CAP: { label: 'Cost per result goal', description: 'Keep the average cost per result around your goal.' },
  LOWEST_COST_WITH_BID_CAP: { label: 'Bid cap', description: 'Set the maximum bid in each auction.' },
  LOWEST_COST_WITH_MIN_ROAS: { label: 'ROAS goal', description: 'Keep return on ad spend above a minimum (value optimisation).' },
};

export const SPECIAL_AD_CATEGORIES = [
  'FINANCIAL_PRODUCTS_SERVICES',
  'EMPLOYMENT',
  'HOUSING',
  'ISSUES_ELECTIONS_POLITICS',
  'ONLINE_GAMBLING_AND_GAMING',
] as const;
export type SpecialAdCategory = (typeof SPECIAL_AD_CATEGORIES)[number];
export const SPECIAL_AD_CATEGORY_LABELS: Record<SpecialAdCategory, string> = {
  FINANCIAL_PRODUCTS_SERVICES: 'Financial products and services (credit)',
  EMPLOYMENT: 'Employment',
  HOUSING: 'Housing',
  ISSUES_ELECTIONS_POLITICS: 'Social issues, elections or politics',
  ONLINE_GAMBLING_AND_GAMING: 'Online gambling and gaming',
};

/** Frequently used call-to-action types for website/lead ads (subset of AdCreative CallToActionType). */
export const CALL_TO_ACTIONS = [
  'LEARN_MORE',
  'SIGN_UP',
  'APPLY_NOW',
  'GET_QUOTE',
  'CONTACT_US',
  'SUBSCRIBE',
  'DOWNLOAD',
  'GET_OFFER',
  'BOOK_NOW',
  'ORDER_NOW',
  'SHOP_NOW',
  'BUY_NOW',
  'SEE_MORE',
  'WATCH_MORE',
  'NO_BUTTON',
] as const;
export type CallToAction = (typeof CALL_TO_ACTIONS)[number];
