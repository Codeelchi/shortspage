import type { CollectionEntry } from 'astro:content';
import { CATEGORY_META, type ShortCategory } from '../config/site';
import { absoluteUrl, withBase } from './site-paths';

export type ShortEntry = CollectionEntry<'shorts'>;

const CATEGORY_ORDER: Record<ShortCategory, number> = {
  'AI News': 0,
  'AI Tools': 1,
  'Tech Trends': 2,
};

export const sortShorts = (entries: ShortEntry[]) => [...entries].sort((a, b) => {
  const publishedDelta = b.data.publishedAt.getTime() - a.data.publishedAt.getTime();
  if (publishedDelta !== 0) return publishedDelta;

  if (a.data.featured !== b.data.featured) return a.data.featured ? -1 : 1;

  const categoryDelta = CATEGORY_ORDER[a.data.category] - CATEGORY_ORDER[b.data.category];
  if (categoryDelta !== 0) return categoryDelta;

  return a.data.title.localeCompare(b.data.title, 'en', { numeric: true });
});

export const getThumbnail = (entry: ShortEntry, absolute = false) => {
  const thumbnail = entry.data.thumbnail;
  const value = thumbnail ? (/^https?:\/\//.test(thumbnail) ? thumbnail : withBase(thumbnail)) : `https://i.ytimg.com/vi/${entry.data.youtubeId}/maxresdefault.jpg`;
  if (!absolute || /^https?:\/\//.test(value)) return value;
  return absoluteUrl(thumbnail ?? '');
};
export const formatDate = (date: Date) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
export const categorySlug = (category: ShortCategory) => CATEGORY_META[category].slug;
export const signalNumber = (index: number) => String(index + 1).padStart(3, '0');
export const durationToIso = (duration?: string) => {
  if (!duration) return undefined;
  const [minutes, seconds] = duration.split(':').map(Number);
  return `PT${minutes ? `${minutes}M` : ''}${seconds ? `${seconds}S` : '0S'}`;
};
