import { fetchJson, normalizeHandle, normalizeHttpUrl } from './common.js';

let tokenCache = { token: '', expiresAt: 0, clientId: '', secret: '' };

async function appToken(clientId, clientSecret) {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 60_000 && tokenCache.clientId === clientId && tokenCache.secret === clientSecret) {
    return tokenCache.token;
  }

  const data = await fetchJson('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' })
  });
  if (!data.access_token) throw new Error('Twitch hat kein Access-Token geliefert. Client-ID/Secret prüfen.');

  tokenCache = {
    token: data.access_token,
    expiresAt: now + Number(data.expires_in || 3600) * 1000,
    clientId,
    secret: clientSecret
  };
  return tokenCache.token;
}

export async function pollTwitch(source, provider) {
  const clientId = String(provider?.clientId || '').trim();
  const clientSecret = String(provider?.clientSecret || '').trim();
  if (!clientId || !clientSecret) throw new Error('Twitch benötigt providers.twitch.clientId + clientSecret in config.json.');

  const token = await appToken(clientId, clientSecret);
  const login = normalizeTwitchLogin(source.target);
  const headers = { Authorization: `Bearer ${token}`, 'Client-Id': clientId };
  const userData = await fetchJson(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`, { headers });
  const user = userData.data?.[0];
  if (!user) throw new Error(`Twitch-Kanal nicht gefunden: ${login}`);

  source.resolvedTarget = user.login;
  const streams = await fetchJson(`https://api.twitch.tv/helix/streams?user_id=${encodeURIComponent(user.id)}`, { headers });
  const live = streams.data?.[0];
  if (!live) return [];

  const category = live.game_name || 'Unbekannt';
  const event = normalizeTwitchEvent(source.event);
  const eventKey = event === 'stream.update'
    ? `stream.update:${live.id}:${live.title}:${live.game_id || ''}`
    : `stream.online:${live.id}`;

  return [{
    eventKey,
    source: 'twitch',
    title: `🔴 ${user.display_name || user.login} ist live!`,
    description: live.title || 'Der Stream ist gerade live.',
    url: `https://twitch.tv/${user.login}`,
    thumbnail: live.thumbnail_url?.replace('{width}', '1280').replace('{height}', '720'),
    timestamp: live.started_at,
    fields: [
      { name: 'Kategorie', value: category, inline: true },
      { name: 'Zuschauer', value: String(live.viewer_count ?? 0), inline: true }
    ]
  }];
}

export function normalizeTwitchLogin(target) {
  const raw = String(target || '').trim();
  if (!raw) throw new Error('Twitch-Ziel fehlt. Nutze @name, name oder eine Twitch-URL.');

  const url = normalizeHttpUrl(raw);
  if (url?.hostname.endsWith('twitch.tv')) {
    const login = url.pathname.split('/').filter(Boolean)[0];
    if (login) return normalizeHandle(login);
  }
  return normalizeHandle(raw);
}

function normalizeTwitchEvent(value) {
  const event = String(value || 'stream.online').toLowerCase();
  if (!['stream.online', 'stream.update'].includes(event)) {
    throw new Error('Twitch-Event muss stream.online oder stream.update sein.');
  }
  return event;
}
