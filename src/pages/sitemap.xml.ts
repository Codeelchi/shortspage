import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { absoluteUrl } from '../utils/paths';

const escapeXml = (value: string) => value.replace(/[<>&'\"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char] ?? char));

export const GET: APIRoute = async () => {
  const shorts = (await getCollection('shorts')).filter((entry) => !entry.data.demo);
  const routes = ['', 'shorts/', 'topics/', 'about/', 'imprint/', 'privacy/', ...shorts.map((entry) => `shorts/${entry.data.slug}/`)];
  const urls = routes.map((route) => `<url><loc>${escapeXml(absoluteUrl(route))}</loc></url>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
