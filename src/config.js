import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const CONFIG_PATH = path.resolve('./config.json');

const defaults = {
  discord: { token: '', clientId: '', guildId: '' },
  notify: {
    default: {
      channelId: '', roleId: '', enabled: true, paused: false, embed: true,
      color: 5793266, footer: 'Maxihihi Notify', prefix: '', cooldownSeconds: 5,
      maxPerHour: 60, quietHours: { enabled: false, start: '23:00', end: '07:00' },
      allowedMentions: 'role'
    },
    guilds: {}
  },
  providers: {
    youtubePollSeconds: 60,
    githubPollSeconds: 60,
    twitchPollSeconds: 30,
    tiktokPollSeconds: 120,
    github: { token: '' },
    twitch: { clientId: '', clientSecret: '' },
    tiktok: { feedUrl: '' }
  },
  sources: []
};

export function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) throw new Error('config.json fehlt. Starte zuerst: npm run setup');
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    throw new Error(`config.json ist kein gültiges JSON: ${e.message}`);
  }
  return normalize(raw);
}

export function saveConfig(config) {
  const normalized = normalize(config);
  const temp = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(normalized, null, 2));
  fs.renameSync(temp, CONFIG_PATH);
  return normalized;
}

export function ensureGuild(config, guildId) {
  config.notify.guilds ||= {};
  if (!config.notify.guilds[guildId]) {
    config.notify.guilds[guildId] = structuredClone(config.notify.default);
  }
  return config.notify.guilds[guildId];
}

export function getGuildSettings(config, guildId) {
  return ensureGuild(config, guildId);
}

export function addSource(config, data) {
  const type = String(data.type || '').toLowerCase();
  if (!['youtube', 'twitch', 'github', 'tiktok'].includes(type)) throw new Error(`Unbekannter Quellentyp: ${type}`);

  const source = {
    id: crypto.randomUUID().slice(0, 8),
    guildId: String(data.guildId),
    type,
    target: String(data.target || '').trim(),
    resolvedTarget: '',
    enabled: data.enabled ?? true,
    channelId: data.channelId ?? '',
    roleId: data.roleId ?? '',
    prefix: data.prefix ?? '',
    color: data.color ?? 5793266,
    embed: data.embed ?? true,
    footer: data.footer ?? 'Maxihihi Notify',
    filters: { include: [], exclude: [], ...(data.filters || {}) },
    event: data.event ?? defaultEvent(type),
    feedUrl: data.feedUrl ?? '',
    initialized: false,
    lastSeen: null
  };
  config.sources.push(source);
  return source;
}

export function removeSource(config, id, guildId) {
  const before = config.sources.length;
  config.sources = config.sources.filter(s => !(s.id === id && s.guildId === guildId));
  return before !== config.sources.length;
}

export function findSource(config, id, guildId) {
  return config.sources.find(s => s.id === id && s.guildId === guildId) || null;
}

export function listSources(config, guildId) {
  return config.sources.filter(s => s.guildId === guildId);
}

function normalize(raw) {
  const sources = Array.isArray(raw.sources) ? raw.sources.map(normalizeSource).filter(Boolean) : [];
  return {
    ...structuredClone(defaults),
    ...raw,
    discord: { ...defaults.discord, ...(raw.discord || {}) },
    notify: {
      ...defaults.notify,
      ...(raw.notify || {}),
      default: {
        ...defaults.notify.default,
        ...(raw.notify?.default || {}),
        quietHours: { ...defaults.notify.default.quietHours, ...(raw.notify?.default?.quietHours || {}) }
      },
      guilds: normalizeGuilds(raw.notify?.guilds || {})
    },
    providers: {
      ...defaults.providers,
      ...(raw.providers || {}),
      github: { ...defaults.providers.github, ...(raw.providers?.github || {}) },
      twitch: { ...defaults.providers.twitch, ...(raw.providers?.twitch || {}) },
      tiktok: { ...defaults.providers.tiktok, ...(raw.providers?.tiktok || {}) }
    },
    sources
  };
}

function normalizeGuilds(guilds) {
  const result = {};
  for (const [id, value] of Object.entries(guilds || {})) {
    result[id] = {
      ...structuredClone(defaults.notify.default),
      ...(value || {}),
      quietHours: { ...defaults.notify.default.quietHours, ...(value?.quietHours || {}) }
    };
  }
  return result;
}

function normalizeSource(raw) {
  if (!raw?.id || !raw?.guildId || !raw?.type || !raw?.target) return null;
  const source = {
    ...raw,
    id: String(raw.id),
    guildId: String(raw.guildId),
    type: String(raw.type).toLowerCase(),
    target: String(raw.target).trim(),
    resolvedTarget: String(raw.resolvedTarget || '').trim(),
    enabled: raw.enabled !== false,
    channelId: String(raw.channelId || ''),
    roleId: String(raw.roleId || ''),
    prefix: String(raw.prefix || ''),
    footer: String(raw.footer || 'Maxihihi Notify'),
    embed: raw.embed !== false,
    color: Number.isFinite(Number(raw.color)) ? Number(raw.color) : 5793266,
    filters: {
      include: Array.isArray(raw.filters?.include) ? raw.filters.include.map(String).filter(Boolean) : [],
      exclude: Array.isArray(raw.filters?.exclude) ? raw.filters.exclude.map(String).filter(Boolean) : []
    },
    event: String(raw.event || defaultEvent(String(raw.type).toLowerCase())),
    feedUrl: String(raw.feedUrl || ''),
    initialized: Boolean(raw.initialized ?? raw.lastSeen),
    lastSeen: raw.lastSeen ? String(raw.lastSeen) : null
  };
  return ['youtube', 'twitch', 'github', 'tiktok'].includes(source.type) ? source : null;
}

function defaultEvent(type) {
  return type === 'github' ? 'releases' : type === 'twitch' ? 'stream.online' : 'new';
}
