import {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ChannelType,
  PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelSelectMenuBuilder, RoleSelectMenuBuilder, EmbedBuilder
} from 'discord.js';
import { loadConfig, saveConfig, ensureGuild, addSource, removeSource, findSource, listSources } from './config.js';
import { sendNotification } from './notifier.js';
import { startPolling, testSource } from './poller.js';

const config = loadConfig();
if (!config.discord.token || !config.discord.clientId) {
  throw new Error('config.json braucht discord.token und discord.clientId. Starte zuerst npm run setup.');
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const command = buildCommand();

client.once('ready', async () => {
  console.log(`[Notify] ${client.user.tag} online.`);

  try {
    const rest = new REST({ version: '10' }).setToken(config.discord.token);
    const body = [command.toJSON()];
    if (config.discord.guildId) {
      await rest.put(Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId), { body });
      console.log(`[Notify] Commands im Server ${config.discord.guildId} registriert.`);
    } else {
      await rest.put(Routes.applicationCommands(config.discord.clientId), { body });
      console.log('[Notify] Globale Slash-Commands registriert.');
    }
  } catch (error) {
    console.error(`[Notify] Command-Registrierung fehlgeschlagen: ${error.message}`);
  }

  startPolling(client, config);
  console.log('[Notify] Polling gestartet: YouTube, Twitch, GitHub, TikTok.');
});

client.on('interactionCreate', async interaction => {
  try {
    if (!interaction.inGuild()) return;
    if (interaction.isChatInputCommand() && interaction.commandName === 'notify') return await handleCommand(interaction);
    if (interaction.isButton()) return await handleButton(interaction);
    if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('notify:channel:')) return await handleChannelSelect(interaction);
    if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('notify:role:')) return await handleRoleSelect(interaction);
  } catch (error) {
    console.error(`[Notify] Interaction-Fehler: ${error.stack || error.message}`);
    const response = { content: `❌ ${String(error.message || 'Unbekannter Fehler').slice(0, 1800)}`, ephemeral: true };
    if (interaction.deferred) await interaction.editReply(response).catch(() => {});
    else if (interaction.replied) await interaction.followUp(response).catch(() => {});
    else await interaction.reply(response).catch(() => {});
  }
});

process.on('unhandledRejection', error => console.error('[Notify] Unhandled rejection:', error));
process.on('uncaughtException', error => console.error('[Notify] Uncaught exception:', error));

await client.login(config.discord.token);

function buildCommand() {
  return new SlashCommandBuilder()
    .setName('notify')
    .setDescription('Maxihihi Notify – Discord-only Self-Host')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString())
    .setDMPermission(false)
    .addSubcommand(s => s.setName('setup').setDescription('Öffnet das Discord-Setup'))
    .addSubcommand(s => s.setName('test').setDescription('Sendet eine Testnachricht').addStringOption(o => o.setName('quelle').setDescription('Optional: Quellen-ID').setRequired(false)))
    .addSubcommand(s => s.setName('status').setDescription('Zeigt Einstellungen und Provider-Status'))
    .addSubcommand(s => s.setName('list').setDescription('Listet alle Quellen'))
    .addSubcommand(s => s.setName('channel').setDescription('Setzt den Standard-Kanal').addChannelOption(o => o.setName('kanal').setDescription('Discord-Kanal').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)))
    .addSubcommand(s => s.setName('add').setDescription('Fügt eine Quelle hinzu')
      .addStringOption(o => o.setName('typ').setDescription('Quelle').setRequired(true).addChoices(
        { name: 'YouTube', value: 'youtube' }, { name: 'Twitch', value: 'twitch' },
        { name: 'GitHub', value: 'github' }, { name: 'TikTok', value: 'tiktok' }
      ))
      .addStringOption(o => o.setName('ziel').setDescription('Handle, URL, UC... oder owner/repository').setRequired(true))
      .addChannelOption(o => o.setName('kanal').setDescription('Optionaler eigener Notify-Kanal').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false))
      .addRoleOption(o => o.setName('rolle').setDescription('Optionale Ping-Rolle').setRequired(false))
      .addStringOption(o => o.setName('event').setDescription('z.B. releases, commits, issues, pulls oder stream.online').setRequired(false)))
    .addSubcommand(s => s.setName('edit').setDescription('Bearbeitet eine Quelle')
      .addStringOption(o => o.setName('id').setDescription('Quellen-ID').setRequired(true))
      .addChannelOption(o => o.setName('kanal').setDescription('Notify-Kanal').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false))
      .addRoleOption(o => o.setName('rolle').setDescription('Ping-Rolle').setRequired(false))
      .addStringOption(o => o.setName('prefix').setDescription('Prefix').setRequired(false))
      .addStringOption(o => o.setName('footer').setDescription('Footer').setRequired(false))
      .addIntegerOption(o => o.setName('farbe').setDescription('Dezimalfarbe').setMinValue(0).setMaxValue(16777215).setRequired(false))
      .addBooleanOption(o => o.setName('embeds').setDescription('Embeds an/aus').setRequired(false))
      .addStringOption(o => o.setName('include').setDescription('Include-Keywords, Komma-getrennt').setRequired(false))
      .addStringOption(o => o.setName('exclude').setDescription('Exclude-Keywords, Komma-getrennt').setRequired(false))
      .addStringOption(o => o.setName('event').setDescription('Quellen-Event').setRequired(false)))
    .addSubcommand(s => s.setName('remove').setDescription('Entfernt eine Quelle').addStringOption(o => o.setName('id').setDescription('Quellen-ID aus /notify list').setRequired(true)))
    .addSubcommand(s => s.setName('enable').setDescription('Aktiviert eine Quelle').addStringOption(o => o.setName('id').setDescription('Quellen-ID').setRequired(true)))
    .addSubcommand(s => s.setName('disable').setDescription('Deaktiviert eine Quelle').addStringOption(o => o.setName('id').setDescription('Quellen-ID').setRequired(true)))
    .addSubcommand(s => s.setName('pause').setDescription('Pausiert alle Benachrichtigungen'))
    .addSubcommand(s => s.setName('resume').setDescription('Fortsetzen aller Benachrichtigungen'))
    .addSubcommand(s => s.setName('settings').setDescription('Ändert zentrale Einstellungen')
      .addBooleanOption(o => o.setName('embeds').setDescription('Embeds an/aus'))
      .addStringOption(o => o.setName('prefix').setDescription('Prefix vor jedem Titel'))
      .addStringOption(o => o.setName('footer').setDescription('Embed-Footer'))
      .addIntegerOption(o => o.setName('farbe').setDescription('Dezimalfarbe, z.B. 5793266').setMinValue(0).setMaxValue(16777215))
      .addIntegerOption(o => o.setName('cooldown').setDescription('Sekunden zwischen Meldungen').setMinValue(0).setMaxValue(3600))
      .addIntegerOption(o => o.setName('max_pro_stunde').setDescription('Max. Meldungen/Stunde').setMinValue(1).setMaxValue(10000))
      .addBooleanOption(o => o.setName('quiet').setDescription('Quiet Hours an/aus'))
      .addStringOption(o => o.setName('quiet_start').setDescription('z.B. 23:00'))
      .addStringOption(o => o.setName('quiet_end').setDescription('z.B. 07:00')));
}

async function handleCommand(i) {
  const guildId = i.guildId;
  const guild = ensureGuild(config, guildId);
  const sub = i.options.getSubcommand();

  if (sub === 'setup') return setupPanel(i);

  if (sub === 'channel') {
    guild.channelId = i.options.getChannel('kanal', true).id;
    saveConfig(config);
    return i.reply({ content: `✅ Standard-Kanal gesetzt: <#${guild.channelId}>`, ephemeral: true });
  }

  if (sub === 'pause') {
    guild.paused = true;
    saveConfig(config);
    return i.reply({ content: '⏸️ Notify pausiert.', ephemeral: true });
  }

  if (sub === 'resume') {
    guild.paused = false;
    saveConfig(config);
    return i.reply({ content: '▶️ Notify läuft wieder.', ephemeral: true });
  }

  if (sub === 'settings') {
    const opts = i.options;
    const embeds = opts.getBoolean('embeds');
    const prefix = opts.getString('prefix');
    const footer = opts.getString('footer');
    const color = opts.getInteger('farbe');
    const cooldown = opts.getInteger('cooldown');
    const maxPerHour = opts.getInteger('max_pro_stunde');
    const quiet = opts.getBoolean('quiet');
    const quietStart = opts.getString('quiet_start');
    const quietEnd = opts.getString('quiet_end');

    if (embeds !== null) guild.embed = embeds;
    if (prefix !== null) guild.prefix = prefix;
    if (footer !== null) guild.footer = footer;
    if (color !== null) guild.color = color;
    if (cooldown !== null) guild.cooldownSeconds = cooldown;
    if (maxPerHour !== null) guild.maxPerHour = maxPerHour;
    if (quiet !== null) guild.quietHours.enabled = quiet;
    if (quietStart !== null) validateClock(quietStart);
    if (quietEnd !== null) validateClock(quietEnd);
    if (quietStart !== null) guild.quietHours.start = quietStart;
    if (quietEnd !== null) guild.quietHours.end = quietEnd;

    saveConfig(config);
    return i.reply({ content: '✅ Einstellungen gespeichert.', ephemeral: true });
  }

  if (sub === 'list') {
    const rows = listSources(config, guildId);
    const content = rows.length
      ? rows.map(s => `**${s.id}** · ${icon(s.type)} ${s.type} · ${s.target} · ${s.enabled ? '🟢' : '⏸️'} · ${s.channelId ? `<#${s.channelId}>` : 'Standard'}${s.resolvedTarget ? ` · ${s.resolvedTarget}` : ''}`).join('\n')
      : 'Noch keine Quellen. Nutze `/notify add`.';
    return i.reply({ content, ephemeral: true });
  }

  if (sub === 'add') {
    const type = i.options.getString('typ', true);
    const target = i.options.getString('ziel', true);
    const channel = i.options.getChannel('kanal');
    const role = i.options.getRole('rolle');
    const event = i.options.getString('event');
    validateTarget(type, target);
    validateEvent(type, event);

    const source = addSource(config, {
      guildId, type, target,
      channelId: channel?.id || '',
      roleId: role?.id || '',
      event: event || undefined
    });
    saveConfig(config);
    return i.reply({ content: `✅ Quelle **${source.id}** hinzugefügt: ${icon(type)} ${target}\nNutze "/notify test quelle:${source.id}" zum Prüfen.`, ephemeral: true });
  }

  if (sub === 'edit') {
    const id = i.options.getString('id', true);
    const source = findSource(config, id, guildId);
    if (!source) return i.reply({ content: '❌ Quellen-ID nicht gefunden.', ephemeral: true });

    const channel = i.options.getChannel('kanal');
    const role = i.options.getRole('rolle');
    const embed = i.options.getBoolean('embeds');
    const prefix = i.options.getString('prefix');
    const footer = i.options.getString('footer');
    const color = i.options.getInteger('farbe');
    const include = i.options.getString('include');
    const exclude = i.options.getString('exclude');
    const event = i.options.getString('event');

    if (channel) source.channelId = channel.id;
    if (role) source.roleId = role.id;
    if (embed !== null) source.embed = embed;
    if (prefix !== null) source.prefix = prefix;
    if (footer !== null) source.footer = footer;
    if (color !== null) source.color = color;
    if (include !== null) source.filters.include = csv(include);
    if (exclude !== null) source.filters.exclude = csv(exclude);
    if (event !== null) { validateEvent(source.type, event); source.event = event; }

    saveConfig(config);
    return i.reply({ content: `✅ Quelle **${source.id}** aktualisiert.`, ephemeral: true });
  }

  if (['remove', 'enable', 'disable'].includes(sub)) {
    const id = i.options.getString('id', true);
    const source = findSource(config, id, guildId);
    if (!source) return i.reply({ content: '❌ Quellen-ID nicht gefunden.', ephemeral: true });
    if (sub === 'remove') removeSource(config, id, guildId); else source.enabled = sub === 'enable';
    saveConfig(config);
    return i.reply({ content: sub === 'remove' ? '🗑️ Quelle gelöscht.' : `✅ Quelle ${source.enabled ? 'aktiviert' : 'deaktiviert'}.`, ephemeral: true });
  }

  if (sub === 'status') return statusReply(i, guild);

  if (sub === 'test') {
    await i.deferReply({ ephemeral: true });
    const id = i.options.getString('quelle');
    const source = id ? findSource(config, id, guildId) : null;
    if (id && !source) return i.editReply('❌ Quellen-ID nicht gefunden.');

    const payload = source
      ? await testSource(client, config, source)
      : { source: 'system', eventKey: `test:${Date.now()}`, title: '🧪 Notify Test', description: 'Dein Maxihihi Notify Bot funktioniert.', fields: [
        { name: 'Discord', value: i.guild.name, inline: true },
        { name: 'Status', value: 'Online ✅', inline: true }
      ] };

    if (!payload) return i.editReply('⚠️ Quelle liefert aktuell kein Event. Bei Twitch kann das bedeuten, dass der Kanal gerade offline ist.');
    const ok = await sendNotification(client, config, guildId, payload, source);
    return i.editReply(ok ? '✅ Test erfolgreich gesendet.' : '⚠️ Test konnte nicht gesendet werden. Kanal/Rechte, Quiet Hours oder Rate-Limits prüfen.');
  }
}

async function setupPanel(i) {
  const payload = buildSetupPayload(i.guildId);
  return i.reply({ ...payload, ephemeral: true });
}

function buildSetupPayload(guildId) {
  const guild = ensureGuild(config, guildId);
  const payloadEmbed = new EmbedBuilder()
    .setTitle('⚡ Maxihihi Notify Setup')
    .setDescription('Alles direkt in Discord. Keine Website.\n\nKanal und Ping-Rolle auswählen und anschließend mit `/notify test` testen.')
    .addFields(
      { name: 'Standard-Kanal', value: guild.channelId ? `<#${guild.channelId}>` : '❌ nicht gesetzt', inline: true },
      { name: 'Ping-Rolle', value: guild.roleId ? `<@&${guild.roleId}>` : 'Keine', inline: true },
      { name: 'Embeds', value: guild.embed ? '✅ an' : '❌ aus', inline: true },
      { name: 'Status', value: guild.paused ? '⏸️ pausiert' : '🟢 aktiv', inline: true },
      { name: 'Quellen', value: String(listSources(config, guildId).length), inline: true },
      { name: 'Quiet Hours', value: guild.quietHours.enabled ? `✅ ${guild.quietHours.start}–${guild.quietHours.end}` : '❌ aus', inline: true }
    )
    .setColor(guild.color || 5793266)
    .setFooter({ text: guild.footer || 'Maxihihi Notify' });

  const row1 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder().setCustomId(`notify:channel:${guildId}`).setPlaceholder('📢 Standard-Kanal auswählen').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder().setCustomId(`notify:role:${guildId}`).setPlaceholder('🔔 Ping-Rolle auswählen')
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`notify:test:${guildId}`).setLabel('Test senden').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`notify:pause:${guildId}`).setLabel(guild.paused ? 'Fortsetzen' : 'Pausieren').setStyle(guild.paused ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`notify:refresh:${guildId}`).setLabel('Aktualisieren').setStyle(ButtonStyle.Primary)
  );
  return { embeds: [payloadEmbed], components: [row1, row2, row3] };
}

async function handleButton(i) {
  if (!i.customId.startsWith('notify:')) return;
  const [, action, guildId] = i.customId.split(':');
  if (guildId !== i.guildId) return i.reply({ content: '❌ Nicht dein Server.', ephemeral: true });

  const guild = ensureGuild(config, guildId);
  if (action === 'test') {
    const ok = await sendNotification(client, config, guildId, {
      source: 'system', eventKey: `button:${Date.now()}`, title: '🧪 Notify Test', description: 'Der Setup-Test funktioniert.',
      fields: [{ name: 'Status', value: 'Online ✅', inline: true }]
    });
    return i.reply({ content: ok ? '✅ Test gesendet.' : '⚠️ Test fehlgeschlagen.', ephemeral: true });
  }

  if (action === 'pause') {
    guild.paused = !guild.paused;
    saveConfig(config);
    return i.update(buildSetupPayload(guildId));
  }

  if (action === 'refresh') return i.update(buildSetupPayload(guildId));
}

async function handleChannelSelect(i) {
  const guild = ensureGuild(config, i.guildId);
  guild.channelId = i.values[0];
  saveConfig(config);
  return i.reply({ content: `✅ Standard-Kanal: <#${guild.channelId}>`, ephemeral: true });
}

async function handleRoleSelect(i) {
  const guild = ensureGuild(config, i.guildId);
  guild.roleId = i.values[0];
  saveConfig(config);
  return i.reply({ content: `✅ Ping-Rolle: <@&${guild.roleId}>`, ephemeral: true });
}

async function statusReply(i, guild) {
  const providers = config.providers;
  return i.reply({ content: [
    '**⚡ Maxihihi Notify Status**',
    `Kanal: ${guild.channelId ? `<#${guild.channelId}>` : '❌'}`,
    `Status: ${guild.paused ? '⏸️ pausiert' : '🟢 aktiv'}`,
    `Embeds: ${guild.embed ? '✅' : '❌'}`,
    `Farbe: ${guild.color}`,
    `Cooldown: ${guild.cooldownSeconds}s`,
    `Max/Stunde: ${guild.maxPerHour}`,
    `Quiet Hours: ${guild.quietHours.enabled ? `${guild.quietHours.start}–${guild.quietHours.end}` : 'aus'}`,
    `YouTube: ✅ ohne API-Key`,
    `GitHub: ${providers.github?.token ? '✅ Token gesetzt' : '🟡 ohne Token (Rate-Limit beachten)'}`,
    `Twitch: ${providers.twitch?.clientId && providers.twitch?.clientSecret ? '✅ konfiguriert' : '❌ nicht konfiguriert'}`,
    `TikTok: ${providers.tiktok?.feedUrl ? '✅ Feed gesetzt' : '❌ Feed fehlt'}`,
    `Quellen: ${listSources(config, i.guildId).length}`
  ].join('\n'), ephemeral: true });
}

function validateTarget(type, target) {
  if (!String(target || '').trim()) throw new Error('Das Ziel darf nicht leer sein.');
  if (type === 'github') {
    const cleaned = String(target).trim().replace(/\/$/, '').replace(/^https?:\/\/github\.com\//i, '');
    if (cleaned.split('/').filter(Boolean).length < 2) throw new Error('GitHub: Nutze owner/repository oder eine GitHub-URL.');
  }
}

function validateEvent(type, event) {
  if (!event) return;
  const value = String(event).toLowerCase();
  if (type === 'github' && !['releases', 'release', 'commits', 'issues', 'pulls', 'pull_requests'].includes(value)) {
    throw new Error('GitHub-Event: releases, commits, issues oder pulls.');
  }
  if (type === 'twitch' && !['stream.online', 'stream.update'].includes(value)) {
    throw new Error('Twitch-Event: stream.online oder stream.update.');
  }
}

function validateClock(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) throw new Error('Uhrzeit muss HH:MM sein, z.B. 23:00.');
}

function csv(value) {
  return String(value).split(',').map(v => v.trim()).filter(Boolean).slice(0, 50);
}

function icon(type) {
  return ({ youtube: '▶️', twitch: '🔴', github: '🐙', tiktok: '🎵' })[type] || '🔔';
}

