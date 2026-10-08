import fs from 'node:fs';
import readline from 'node:readline';
import { CONFIG_PATH } from '../src/config.js';

if (fs.existsSync(CONFIG_PATH)) {
  console.log('config.json existiert bereits. Bearbeite sie direkt oder lösche sie für ein neues Setup.');
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const q = text => new Promise(resolve => rl.question(text, resolve));

console.log('\n⚡ Maxihihi Notify 2.1 – Self-Host Setup\n');
const token = await q('Discord Bot Token: ');
const clientId = await q('Discord Application ID: ');
const guildId = await q('Optional Discord Server ID (leer für global): ');

const config = {
  discord: { token: token.trim(), clientId: clientId.trim(), guildId: guildId.trim() },
  notify: {
    default: {
      channelId: '', roleId: '', enabled: true, paused: false, embed: true, color: 5793266,
      footer: 'Maxihihi Notify', prefix: '', cooldownSeconds: 5, maxPerHour: 60,
      quietHours: { enabled: false, start: '23:00', end: '07:00' }, allowedMentions: 'role'
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

fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
rl.close();
console.log('\n✅ config.json erstellt. Jetzt: npm start\n');
console.log('YouTube: @Handle, YouTube-URL oder UC... funktionieren automatisch.');
console.log('GitHub: owner/repository oder vollständige GitHub-URL.');
console.log('Twitch: @name, name oder Twitch-URL; providers.twitch.clientId/clientSecret setzen.');
console.log('TikTok: Ziel kann @name/name/URL sein; feedUrl muss selbst konfiguriert werden.');
