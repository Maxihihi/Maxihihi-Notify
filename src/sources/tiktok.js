import { fetchAuto, allXmlEntries, xmlTag, xmlAttr, normalizeHandle, normalizeHttpUrl } from './common.js';

export async function pollTikTok(source, provider) {
  const feedUrl = source.feedUrl || provider?.feedUrl;
  if (!feedUrl) {
    throw new Error('TikTok benötigt eine konfigurierte feedUrl/API-URL. TikTok bietet für beliebige Creator keinen einfachen anonymen öffentlichen Feed.');
  }

  const creator = normalizeTikTokTarget(source.target);
  const result = await fetchAuto(feedUrl);
  const items = result.kind === 'json' ? normalizeJsonItems(result.value) : normalizeXmlItems(result.value);
  if (!items.length) return [];

  return items.slice(0, 15).map((item, i) => {
    const id = String(item.id || item.video_id || item.item_id || item.aweme_id || item.url || `item-${i}`);
    const timestamp = normalizeTimestamp(item.create_time || item.created_at || item.timestamp);
    const url = item.url || item.share_url || item.video_url || item.permalink;
    const title = item.title || item.description || item.caption || 'Neuer TikTok-Post';
    return {
      eventKey: `tiktok:${creator}:${id}`,
      source: 'tiktok',
      title: `🎵 ${title}`,
      description: `Neuer TikTok-Post von **${creator}**`,
      url,
      thumbnail: item.cover_url || item.cover_image_url || item.thumbnail_url || item.image_url,
      timestamp,
      fields: [{ name: 'Creator', value: creator, inline: true }]
    };
  }).filter(x => x.url);
}

export function normalizeTikTokTarget(target) {
  const raw = String(target || '').trim();
  if (!raw) throw new Error('TikTok-Ziel fehlt. Nutze @name, name oder eine TikTok-URL.');
  const url = normalizeHttpUrl(raw);
  if (url?.hostname.endsWith('tiktok.com')) {
    const handle = url.pathname.split('/').filter(Boolean).find(part => part.startsWith('@'));
    if (handle) return handle;
  }
  return `@${normalizeHandle(raw)}`;
}

function normalizeJsonItems(data) {
  if (Array.isArray(data)) return data;
  const candidates = [data?.items, data?.data, data?.videos, data?.results, data?.aweme_list];
  return candidates.find(Array.isArray) || [];
}

function normalizeXmlItems(xml) {
  return allXmlEntries(xml).map(entry => ({
    id: xmlTag(entry, 'guid') || xmlTag(entry, 'id'),
    title: xmlTag(entry, 'title'),
    description: xmlTag(entry, 'description') || xmlTag(entry, 'summary'),
    url: xmlAttr(entry, 'link', 'href') || xmlTag(entry, 'link'),
    created_at: xmlTag(entry, 'published') || xmlTag(entry, 'updated')
  }));
}

function normalizeTimestamp(value) {
  if (value === undefined || value === null || value === '') return new Date().toISOString();
  if (/^\d+$/.test(String(value))) {
    const numeric = Number(value);
    return new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
