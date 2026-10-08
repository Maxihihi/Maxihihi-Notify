import { EmbedBuilder } from 'discord.js';
import { getGuildSettings } from './config.js';

const recent = new Map();
const hourly = new Map();
const sent = new Set();

export async function sendNotification(client, config, guildId, payload, source = null, override = {}) {
  const guild = getGuildSettings(config, guildId);
  if (!guild || !guild.enabled || guild.paused) return false;

  const channelId = override.channelId || source?.channelId || guild.channelId;
  if (!channelId) return false;
  if (isQuiet(guild.quietHours)) return false;

  const sourceName = source?.type || payload.source || 'system';
  const eventKey = payload.eventKey || `${Date.now()}:${Math.random()}`;
  const dedupeKey = `${guildId}:${sourceName}:${eventKey}`;
  if (sent.has(dedupeKey)) return false;

  const now = Date.now();
  const cooldown = Math.max(0, Number(guild.cooldownSeconds || 0)) * 1000;
  const last = recent.get(`${guildId}:${channelId}`) || 0;
  if (now - last < cooldown) return false;

  const hourKey = `${guildId}:${Math.floor(now / 3600000)}`;
  const count = hourly.get(hourKey) || 0;
  if (count >= Math.max(1, Number(guild.maxPerHour || 60))) return false;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.() || !channel.send) return false;

  const roleId = override.roleId ?? source?.roleId ?? guild.roleId ?? '';
  const prefix = override.prefix ?? source?.prefix ?? guild.prefix ?? '';
  const footer = String(override.footer ?? source?.footer ?? guild.footer ?? 'Maxihihi Notify').slice(0, 2048);
  const color = Number(override.color ?? source?.color ?? guild.color ?? 5793266);
  const embedEnabled = override.embed ?? source?.embed ?? guild.embed ?? true;
  const title = `${prefix}${payload.title || 'Neue Benachrichtigung'}`.slice(0, 256);
  const mention = roleId ? `<@&${roleId}>` : '';
  const allowedMentions = roleId && guild.allowedMentions !== 'none' ? { roles: [roleId] } : { parse: [] };

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(String(payload.description || '').slice(0, 4096))
    .setColor(Number.isFinite(color) ? Math.max(0, Math.min(16777215, color)) : 5793266)
    .setTimestamp(validDate(payload.timestamp) ? new Date(payload.timestamp) : new Date())
    .setFooter({ text: footer });

  if (payload.url && isHttp(payload.url)) embed.setURL(payload.url);
  if (isHttp(payload.thumbnail)) embed.setThumbnail(payload.thumbnail);
  if (isHttp(payload.image)) embed.setImage(payload.image);

  for (const field of Array.isArray(payload.fields) ? payload.fields.slice(0, 25) : []) {
    if (!field?.name || !field?.value) continue;
    embed.addFields({
      name: String(field.name).slice(0, 256),
      value: String(field.value).slice(0, 1024),
      inline: Boolean(field.inline)
    });
  }

  const message = { content: mention || undefined, allowedMentions };
  if (embedEnabled) {
    message.embeds = [embed];
  } else {
    message.content = [mention, payload.plain || title, payload.url].filter(Boolean).join('\n').slice(0, 2000);
  }

  try {
    await channel.send(message);
  } catch (error) {
    console.error(`[Notify] Discord-Senden fehlgeschlagen (${channelId}): ${error.message}`);
    return false;
  }

  sent.add(dedupeKey);
  recent.set(`${guildId}:${channelId}`, now);
  hourly.set(hourKey, count + 1);
  cleanup();
  return true;
}

export function isQuiet(hours) {
  if (!hours?.enabled) return false;
  const start = parseClock(hours.start, 23 * 60);
  const end = parseClock(hours.end, 7 * 60);
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

function getGuildSettingsSafe(config, guildId) {
  return getGuildSettings(config, guildId);
}

function parseClock(value, fallback) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return fallback;
  return hour * 60 + minute;
}

function validDate(value) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time);
}

function isHttp(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function cleanup() {
  if (sent.size > 10000) {
    const keep = [...sent].slice(-5000);
    sent.clear();
    for (const key of keep) sent.add(key);
  }
  const currentHour = Math.floor(Date.now() / 3600000);
  for (const key of hourly.keys()) {
    const hour = Number(key.split(':').at(-1));
    if (Number.isFinite(hour) && hour < currentHour - 2) hourly.delete(key);
  }
}

// Keep one exported helper name for backwards compatibility with older installs.
export const getGuildSettingsForNotifier = getGuildSettingsSafe;
