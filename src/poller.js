import { pollYouTube } from './sources/youtube.js';
import { pollGitHub } from './sources/github.js';
import { pollTwitch } from './sources/twitch.js';
import { pollTikTok } from './sources/tiktok.js';
import { matchesFilters } from './sources/common.js';
import { saveConfig } from './config.js';
import { sendNotification } from './notifier.js';

const running = new Set();
const errors = new Map();

export function startPolling(client, config) {
  const timers = [
    setInterval(() => pollType(client, config, 'youtube'), ms(config.providers.youtubePollSeconds, 60)),
    setInterval(() => pollType(client, config, 'github'), ms(config.providers.githubPollSeconds, 60)),
    setInterval(() => pollType(client, config, 'twitch'), ms(config.providers.twitchPollSeconds, 30)),
    setInterval(() => pollType(client, config, 'tiktok'), ms(config.providers.tiktokPollSeconds, 120))
  ];

  for (const type of ['youtube', 'github', 'twitch', 'tiktok']) void pollType(client, config, type);

  for (const timer of timers) timer.unref?.();
  return () => timers.forEach(clearInterval);
}

async function pollType(client, config, type) {
  const sources = config.sources.filter(s => s.enabled && s.type === type && !running.has(s.id));

  for (const source of sources) {
    running.add(source.id);
    try {
      const events = await fetchEvents(config, source);
      const ordered = sortEvents(events);

      if (!ordered.length) {
        clearError(source.id);
        continue;
      }

      // YouTube/GitHub/TikTok werden beim ersten Abruf nur initialisiert,
      // damit alte Einträge nicht als neue Meldungen gespammt werden.
      // Twitch ist anders: Eine beim ersten Abruf beobachtete Live-Session ist
      // für unser Polling bereits ein gültiges stream.online-Event.
      if (!source.initialized && type !== 'twitch') {
        source.lastSeen = ordered.at(-1).eventKey;
        source.initialized = true;
        saveConfig(config);
        clearError(source.id);
        continue;
      }

      if (!source.initialized && type === 'twitch') source.initialized = true;

      const fresh = freshEvents(ordered, source.lastSeen);
      for (const event of fresh) {
        if (!matchesFilters(event, source.filters)) {
          source.lastSeen = event.eventKey;
          continue;
        }

        const sent = await sendNotification(client, config, source.guildId, event, source);
        if (sent) source.lastSeen = event.eventKey;
      }

      if (fresh.length) saveConfig(config);
      clearError(source.id);
    } catch (error) {
      reportError(source, error);
    } finally {
      running.delete(source.id);
    }
  }
}

async function fetchEvents(config, source) {
  switch (source.type) {
    case 'youtube': return pollYouTube(source);
    case 'github': return pollGitHub(source, config.providers.github);
    case 'twitch': return pollTwitch(source, config.providers.twitch);
    case 'tiktok': return pollTikTok(source, config.providers.tiktok);
    default: throw new Error(`Unbekannter Quellentyp: ${source.type}`);
  }
}

function sortEvents(events) {
  return [...events]
    .filter(event => event?.eventKey)
    .sort((a, b) => toTime(a.timestamp) - toTime(b.timestamp));
}

function freshEvents(events, lastSeen) {
  if (!lastSeen) return events;
  const index = events.findIndex(event => event.eventKey === lastSeen);
  return index === -1 ? events : events.slice(index + 1);
}

export async function testSource(client, config, source) {
  const events = await fetchEvents(config, source);
  return sortEvents(events).at(-1) || null;
}

function reportError(source, error) {
  const message = String(error?.message || error);
  if (errors.get(source.id) === message) return;
  errors.set(source.id, message);
  console.error(`[Notify] ${source.type}/${source.target}: ${message}`);
}

function clearError(sourceId) {
  errors.delete(sourceId);
}

function toTime(value) {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function ms(value, fallback) {
  const seconds = Math.max(10, Number(value) || fallback);
  return seconds * 1000;
}
