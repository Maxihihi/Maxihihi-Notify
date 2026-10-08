import { fetchText, allXmlEntries, xmlTag, xmlAttr, normalizeHandle, normalizeHttpUrl } from './common.js';

const channelCache = new Map();
const CHANNEL_TTL = 24 * 60 * 60 * 1000;

export async function resolveYouTubeChannelId(target) {
  const raw = String(target || '').trim();
  if (!raw) throw new Error('YouTube-Ziel fehlt. Nutze z.B. @Maxi-hihi oder eine Channel-ID.');

  const direct = raw.match(/\b(UC[a-zA-Z0-9_-]{20,})\b/);
  if (direct) return direct[1];

  const cached = channelCache.get(raw.toLowerCase());
  if (cached && cached.expiresAt > Date.now()) return cached.id;

  const url = normalizeHttpUrl(raw);
  const candidates = [];

  if (url?.hostname.endsWith('youtube.com')) {
    const channelPath = url.pathname.match(/^\/channel\/(UC[a-zA-Z0-9_-]{20,})/i);
    if (channelPath) return channelPath[1];
    candidates.push(url.href);
  } else if (url) {
    throw new Error('YouTube-URL muss youtube.com enthalten.');
  } else {
    const handle = normalizeHandle(raw);
    candidates.push(`https://www.youtube.com/@${encodeURIComponent(handle)}`);
    candidates.push(`https://www.youtube.com/user/${encodeURIComponent(handle)}`);
    candidates.push(`https://www.youtube.com/c/${encodeURIComponent(handle)}`);
  }

  // First try the direct profile variants.
  for (const candidate of candidates) {
    try {
      const html = await fetchText(candidate, { headers: { accept: 'text/html,application/xhtml+xml' } });
      const id = extractChannelId(html);
      if (id) {
        channelCache.set(raw.toLowerCase(), { id, expiresAt: Date.now() + CHANNEL_TTL });
        return id;
      }
    } catch {
      // Try the next URL variant.
    }
  }

  // Fallback for a display name such as "Maxi-hihi" when the actual handle is different.
  if (!url) {
    try {
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(raw)}`;
      const html = await fetchText(searchUrl, { headers: { accept: 'text/html,application/xhtml+xml' } });
      const id = extractChannelIdFromSearch(html);
      if (id) {
        channelCache.set(raw.toLowerCase(), { id, expiresAt: Date.now() + CHANNEL_TTL });
        return id;
      }
    } catch {
      // Keep the final, useful error message below.
    }
  }

  throw new Error(`YouTube-Kanal nicht gefunden: ${raw}. Nutze @Handle, youtube.com/@Handle oder die UC...-Channel-ID.`);
}

export async function pollYouTube(source) {
  const channelId = await resolveYouTubeChannelId(source.resolvedTarget || source.target);
  source.resolvedTarget = channelId;

  const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`);
  const entries = allXmlEntries(xml);
  if (!entries.length) return [];

  return entries.slice(0, 15).map(entry => {
    const videoId = xmlTag(entry, 'yt:videoId') || xmlTag(entry, 'videoId');
    const title = xmlTag(entry, 'title') || 'Neues YouTube-Video';
    const published = xmlTag(entry, 'published') || xmlTag(entry, 'updated');
    const updated = xmlTag(entry, 'updated');
    const author = xmlTag(entry, 'name');
    const link = xmlAttr(entry, 'link', 'href') || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : undefined);
    return {
      eventKey: videoId ? `video:${videoId}` : `video:${channelId}:${title}:${published}`,
      source: 'youtube',
      title: `▶️ ${title}`,
      description: author ? `Neues Video von **${author}**` : 'Neues YouTube-Video',
      url: link,
      thumbnail: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : undefined,
      timestamp: updated || published,
      fields: [
        { name: 'Kanal', value: `[YouTube öffnen](https://www.youtube.com/channel/${channelId})`, inline: true },
        ...(published ? [{ name: 'Veröffentlicht', value: `<t:${Math.floor(new Date(published).getTime() / 1000)}:R>`, inline: true }] : [])
      ]
    };
  }).filter(x => x.eventKey && x.url);
}

function extractChannelIdFromSearch(html) {
  const patterns = [
    /\"channelRenderer\":\{\"channelId\":\"(UC[a-zA-Z0-9_-]{20,})\"/i,
    /\"browseId\":\"(UC[a-zA-Z0-9_-]{20,})\"/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function extractChannelId(html) {
  const patterns = [
    /<link[^>]+rel=["']canonical["'][^>]+href=["']https?:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{20,})/i,
    /<link[^>]+href=["']https?:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{20,})["'][^>]+rel=["']canonical["']/i,
    /<meta[^>]+itemprop=["']channelId["'][^>]+content=["'](UC[a-zA-Z0-9_-]{20,})["']/i,
    /<meta[^>]+content=["'](UC[a-zA-Z0-9_-]{20,})["'][^>]+itemprop=["']channelId["']/i,
    /"channelId":"(UC[a-zA-Z0-9_-]{20,})"/i,
    /"externalChannelId":"(UC[a-zA-Z0-9_-]{20,})"/i,
    /https?:\\?\/\\?\/www\.youtube\.com\\?\/channel\\?\/(UC[a-zA-Z0-9_-]{20,})/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}
