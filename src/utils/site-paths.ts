import { SITE } from '../config/site';
const BASE = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
export const withBase = (path = '') => `${BASE}${path.startsWith('/') ? path.slice(1) : path}`;
export const absoluteUrl = (path = '') => `${SITE.origin}${withBase(path)}`;
export const shortUrl = (slug: string) => withBase(`shorts/${slug}/`);
export const topicFilterUrl = (category: string) => `${withBase('shorts/')}?category=${encodeURIComponent(category)}`;
