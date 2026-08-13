import type { CollectionEntry } from 'astro:content';
import { CATEGORY_META, type ShortCategory } from '../config/site';
import { absoluteUrl, withBase } from './paths';

export type ShortEntry = CollectionEntry<'shorts'>;
export const sortShorts = (entries: ShortEntry[]) => [...entries].sort((a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime());
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
