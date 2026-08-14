export const SITE = {
  name: 'AI&TECH TRENDS',
  shortName: 'AITT',
  tagline: 'Fast insights. Zero fluff.',
  description: 'Fast YouTube Shorts about AI news, useful tools, automation, workflows and emerging technology.',
  origin: 'https://codeelchi.github.io',
  youtubeChannel: 'https://www.youtube.com/@AiTechTrendsShort',
  youtubeShorts: 'https://www.youtube.com/@AiTechTrendsShort/shorts',
  youtubeSubscribe: 'https://www.youtube.com/@AiTechTrendsShort?sub_confirmation=1',
  instagram: 'https://www.instagram.com/ai_techtrends.short/',
  tiktok: 'https://www.tiktok.com/@aitrendsnews',
  facebook: 'https://www.facebook.com/profile.php?id=61592914213982',
  githubUrl: 'https://github.com/Codeelchi/shortspage',
} as const;

export const SOCIAL_LINKS = [
  { key: 'youtube', label: 'YouTube', href: SITE.youtubeChannel, description: 'Watch the latest AI & tech Shorts.' },
  { key: 'instagram', label: 'Instagram', href: SITE.instagram, description: 'Follow AI & Tech Trends on Instagram.' },
  { key: 'tiktok', label: 'TikTok', href: SITE.tiktok, description: 'Fast AI and tech signals on TikTok.' },
  { key: 'facebook', label: 'Facebook', href: SITE.facebook, description: 'Follow updates and crossposts on Facebook.' },
] as const;

export const CATEGORY_META = {
  'AI News': { slug: 'ai-news', eyebrow: 'BREAKING NEWS', title: 'AI NEWS', summary: 'Models, releases, companies and industry shifts.' },
  'AI Tools': { slug: 'ai-tools', eyebrow: 'TOP TOOLS', title: 'AI TOOLS', summary: 'Apps, agents, automation and workflows.' },
  'Tech Trends': { slug: 'tech-trends', eyebrow: 'TECH RADAR', title: 'TECH TRENDS', summary: 'Software, digital business and future tech.' },
} as const;

export type ShortCategory = keyof typeof CATEGORY_META;
