import { SITE } from '../config/site';

export const withBase = (path = '') => `${import.meta.env.BASE_URL}${path.startsWith('/') ? path.slice(1) : path}`;
export const absoluteUrl = (path = '') => `${SITE.origin}${withBase(path)}`;
export const shortUrl = (slug: string) => withBase(`shorts/${slug}/`);
export const topicFilterUrl = (category: string) => `${withBase('shorts/')}?category=${encodeURIComponent(category)}`;
