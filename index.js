"use strict";

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const { Pool } = require("pg");

/* =========================================================
   CONFIG
========================================================= */

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const DATABASE_URL = process.env.DATABASE_URL;

const SERVER_ID = "1493700265499689154";
const SUPPORT_ADMIN_ROLE_ID = "1542498406981959801";
const SUPPORT_LOG_CHANNEL_ID = "1542500573000106024";

if (!TOKEN || !CLIENT_ID || !DATABASE_URL) {
  console.error("❌ Missing TOKEN, CLIENT_ID or DATABASE_URL.");
  process.exit(1);
}

/* =========================================================
   CLIENT
========================================================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.GuildMember
  ]
});

/* =========================================================
   DATABASE
========================================================= */

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10
});

async function db(sql, params = []) {
  return pool.query(sql, params);
}

async function initDB() {
  await db(`
    CREATE TABLE IF NOT EXISTS settings (
      guild_id TEXT PRIMARY KEY,
      ticket_category TEXT,
      log_channel TEXT,
      support_role TEXT,
      auto_role TEXT,
      verify_role TEXT,
      welcome_channel TEXT,
      goodbye_channel TEXT,
      automod BOOLEAN DEFAULT TRUE,
      spam BOOLEAN DEFAULT TRUE,
      links BOOLEAN DEFAULT TRUE,
      invites BOOLEAN DEFAULT TRUE,
      mentions BOOLEAN DEFAULT TRUE,
      badwords BOOLEAN DEFAULT TRUE,
      auto_timeout BOOLEAN DEFAULT TRUE,
      antiraid BOOLEAN DEFAULT TRUE,
      lockdown BOOLEAN DEFAULT FALSE,
      verification BOOLEAN DEFAULT FALSE,
      inactivity_hours INTEGER DEFAULT 48,
      badword_list TEXT DEFAULT ''
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS tickets (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      channel_id TEXT,
      status TEXT DEFAULT 'open',
      claimed_by TEXT,
      held BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      closed_at TIMESTAMP
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS ticket_messages (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
      author_id TEXT,
      direction TEXT,
      content TEXT,
      attachments TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS ticket_notes (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
      staff_id TEXT,
      note TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS ticket_events (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
      actor_id TEXT,
      action TEXT,
      details TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS warnings (
      id SERIAL PRIMARY KEY,
      guild_id TEXT,
      user_id TEXT,
      moderator_id TEXT,
      reason TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS modlogs (
      id SERIAL PRIMARY KEY,
      guild_id TEXT,
      user_id TEXT,
      moderator_id TEXT,
      action TEXT,
      reason TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS blocked_users (
      guild_id TEXT,
      user_id TEXT,
      reason TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (guild_id,user_id)
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS ratings (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
      user_id TEXT,
      rating INTEGER,
      comment TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(ticket_id,user_id)
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS staff_activity (
      id SERIAL PRIMARY KEY,
      guild_id TEXT,
      staff_id TEXT,
      action TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db(`
    INSERT INTO settings(guild_id)
    VALUES($1)
    ON CONFLICT(guild_id) DO NOTHING
  `, [SERVER_ID]);

  console.log("✅ PostgreSQL ready.");
}

/* =========================================================
   HELPERS
========================================================= */

async function settings(guildId) {
  const r = await db(
    `SELECT * FROM settings WHERE guild_id=$1`,
    [guildId]
  );
  return r.rows[0];
}

function staff(member) {
  return !!member &&
    (
      member.permissions.has(PermissionsBitField.Flags.Administrator) ||
      member.roles.cache.has(SUPPORT_ADMIN_ROLE_ID)
    );
}

function moderator(member) {
  return !!member && (
    member.permissions.has(PermissionsBitField.Flags.ModerateMembers) ||
    member.permissions.has(PermissionsBitField.Flags.KickMembers) ||
    member.permissions.has(PermissionsBitField.Flags.BanMembers) ||
    member.permissions.has(PermissionsBitField.Flags.Administrator)
  );
}

function manager(member) {
  return !!member && (
    member.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
    member.permissions.has(PermissionsBitField.Flags.Administrator)
  );
}

async function reply(i, content, ephemeral = true) {
  if (i.replied || i.deferred) {
    return i.followUp({ content, ephemeral });
  }
  return i.reply({ content, ephemeral });
}

async function log(guild, title, description, fields = []) {
  try {
    const s = await settings(guild.id);
    const id = s?.log_channel || SUPPORT_LOG_CHANNEL_ID;
    const channel = guild.channels.cache.get(id);

    if (!channel) return;

    const e = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description || "")
      .addFields(fields)
      .setTimestamp();

    await channel.send({ embeds: [e] });
  } catch (e) {
    console.error("Log error:", e.message);
  }
}

async function modlog(guildId, userId, moderatorId, action, reason) {
  await db(`
    INSERT INTO modlogs
    (guild_id,user_id,moderator_id,action,reason)
    VALUES($1,$2,$3,$4,$5)
  `, [guildId, userId, moderatorId, action, reason || "No reason"]);
}

async function activity(guildId, userId, action) {
  await db(`
    INSERT INTO staff_activity(guild_id,staff_id,action)
    VALUES($1,$2,$3)
  `, [guildId, userId, action]);
}

/* =========================================================
   COMMANDS
========================================================= */

const C = [];

function cmd(name, description) {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description);
}

/* Tickets */

C.push(
  cmd("ticket", "Create a support ticket"),

  cmd("ticket-close", "Close the current ticket")
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
        .setRequired(false)
    ),

  cmd("ticket-reopen", "Reopen a ticket")
    .addIntegerOption(o =>
      o.setName("id")
        .setDescription("Ticket ID")
        .setRequired(true)
    ),

  cmd("ticket-claim", "Claim current ticket"),
  cmd("ticket-unclaim", "Unclaim current ticket"),
  cmd("ticket-hold", "Put current ticket on hold"),
  cmd("ticket-resume", "Resume current ticket"),

  cmd("ticket-transfer", "Transfer ticket")
    .addUserOption(o =>
      o.setName("staff")
        .setDescription("Staff")
        .setRequired(true)
    ),

  cmd("ticket-add", "Add user to ticket")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true)
    ),

  cmd("ticket-remove", "Remove user from ticket")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true)
    ),

  cmd("ticket-rename", "Rename ticket")
    .addStringOption(o =>
      o.setName("name")
        .setDescription("New name")
        .setRequired(true)
    ),

  cmd("ticket-note", "Add internal note")
    .addStringOption(o =>
      o.setName("note")
        .setDescription("Note")
        .setRequired(true)
    ),

  cmd("ticket-notes", "View ticket notes"),
  cmd("ticket-history", "View ticket history"),
  cmd("ticket-transcript", "View ticket transcript"),

  cmd("ticket-block", "Block user from support")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
        .setRequired(false)
    ),

  cmd("ticket-unblock", "Unblock user")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true)
    ),

  cmd("ticket-info", "Show ticket information"),
  cmd("ticket-rating", "Show ticket rating"),
  cmd("ticket-stats", "Show ticket statistics"),

  cmd("reply", "Reply to ticket user")
    .addStringOption(o =>
      o.setName("message")
        .setDescription("Reply")
        .setRequired(true)
    ),

  cmd("dm", "Send DM to user")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("message")
        .setDescription("Message")
        .setRequired(true)
    )
);

/* Moderation */

C.push(
  cmd("warn", "Warn a member")
    .addUserOption(o =>
      o.setName("user").setDescription("Member").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason").setRequired(true)
    ),

  cmd("warnings", "Show warnings")
    .addUserOption(o =>
      o.setName("user").setDescription("Member").setRequired(true)
    ),

  cmd("clear", "Delete messages")
    .addIntegerOption(o =>
      o.setName("amount")
        .setDescription("1-100")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    ),

  cmd("timeout", "Timeout member")
    .addUserOption(o =>
      o.setName("user").setDescription("Member").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("minutes")
        .setDescription("Minutes")
        .setMinValue(1)
        .setMaxValue(40320)
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason").setRequired(false)
    ),

  cmd("untimeout", "Remove timeout")
    .addUserOption(o =>
      o.setName("user").setDescription("Member").setRequired(true)
    ),

  cmd("kick", "Kick member")
    .addUserOption(o =>
      o.setName("user").setDescription("Member").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason").setRequired(false)
    ),

  cmd("ban", "Ban member")
    .addUserOption(o =>
      o.setName("user").setDescription("Member").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason").setRequired(false)
    ),

  cmd("unban", "Unban user")
    .addStringOption(o =>
      o.setName("userid").setDescription("User ID").setRequired(true)
    ),

  cmd("modlogs", "Show moderation logs")
    .addUserOption(o =>
      o.setName("user").setDescription("User").setRequired(true)
    ),

  cmd("purge", "Delete messages")
    .addIntegerOption(o =>
      o.setName("amount")
        .setDescription("Amount")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    ),

  cmd("slowmode", "Set slowmode")
    .addIntegerOption(o =>
      o.setName("seconds")
        .setDescription("Seconds")
        .setMinValue(0)
        .setMaxValue(21600)
        .setRequired(true)
    ),

  cmd("lock", "Lock channel"),
  cmd("unlock", "Unlock channel"),

  cmd("softban", "Ban and remove recent messages")
    .addUserOption(o =>
      o.setName("user").setDescription("Member").setRequired(true)
    )
);

/* AutoMod */

C.push(
  cmd("automod", "Enable or disable AutoMod")
    .addBooleanOption(o =>
      o.setName("enabled").setDescription("Enabled").setRequired(true)
    ),

  cmd("automod-status", "Show AutoMod status"),

  cmd("automod-spam", "Configure anti spam")
    .addBooleanOption(o =>
      o.setName("enabled").setDescription("Enabled").setRequired(true)
    ),

  cmd("automod-links", "Configure link filter")
    .addBooleanOption(o =>
      o.setName("enabled").setDescription("Enabled").setRequired(true)
    ),

  cmd("automod-invites", "Configure invite filter")
    .addBooleanOption(o =>
      o.setName("enabled").setDescription("Enabled").setRequired(true)
    ),

  cmd("automod-mentions", "Configure mention protection")
    .addBooleanOption(o =>
      o.setName("enabled").setDescription("Enabled").setRequired(true)
    ),

  cmd("automod-words", "Configure bad words")
    .addStringOption(o =>
      o.setName("words").setDescription("Comma separated words").setRequired(true)
    ),

  cmd("automod-timeout", "Configure automatic timeout")
    .addBooleanOption(o =>
      o.setName("enabled").setDescription("Enabled").setRequired(true)
    )
);

/* Security */

C.push(
  cmd("security", "Enable security")
    .addBooleanOption(o =>
      o.setName("enabled").setDescription("Enabled").setRequired(true)
    ),

  cmd("security-status", "Show security status"),
  cmd("raidmode", "Enable raid mode"),
  cmd("raidmode-off", "Disable raid mode"),
  cmd("lockdown", "Lock server"),
  cmd("lockdown-off", "Unlock server"),

  cmd("verification", "Configure verification")
    .addBooleanOption(o =>
      o.setName("enabled").setDescription("Enabled").setRequired(true)
    ),

  cmd("verification-set", "Set verification role")
    .addRoleOption(o =>
      o.setName("role").setDescription("Role").setRequired(true)
    ),

  cmd("verification-remove", "Remove verification role"),

  cmd("antiraid", "Configure anti raid")
    .addBooleanOption(o =>
      o.setName("enabled").setDescription("Enabled").setRequired(true)
    ),

  cmd("antiraid-config", "Configure raid threshold")
    .addIntegerOption(o =>
      o.setName("joins")
        .setDescription("Joins")
        .setMinValue(2)
        .setMaxValue(50)
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("seconds")
        .setDescription("Seconds")
        .setMinValue(1)
        .setMaxValue(60)
        .setRequired(true)
    )
);

/* Staff */

C.push(
  cmd("admin-stats", "Show admin statistics"),
  cmd("staff", "Show support staff"),

  cmd("staff-info", "Show staff member information")
    .addUserOption(o =>
      o.setName("user").setDescription("Staff").setRequired(true)
    ),

  cmd("staff-stats", "Show staff statistics")
    .addUserOption(o =>
      o.setName("user").setDescription("Staff").setRequired(false)
    ),

  cmd("staff-leaderboard", "Show staff leaderboard"),

  cmd("activity", "Show staff activity")
    .addUserOption(o =>
      o.setName("user").setDescription("Staff").setRequired(false)
    ),

  cmd("modstats", "Show moderation statistics")
);

/* Server */

C.push(
  cmd("announce", "Send announcement")
    .addStringOption(o =>
      o.setName("message").setDescription("Announcement").setRequired(true)
    ),

  cmd("say", "Make bot say message")
    .addStringOption(o =>
      o.setName("message").setDescription("Message").setRequired(true)
    ),

  cmd("embed", "Send embed")
    .addStringOption(o =>
      o.setName("title").setDescription("Title").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("description").setDescription("Description").setRequired(true)
    ),

  cmd("poll", "Create poll")
    .addStringOption(o =>
      o.setName("question").setDescription("Question").setRequired(true)
    )
);

/* Config */

C.push(
  cmd("config-view", "View configuration"),

  cmd("setlogs", "Set log channel")
    .addChannelOption(o =>
      o.setName("channel").setDescription("Channel").setRequired(true)
    ),

  cmd("setticket", "Set ticket category")
    .addChannelOption(o =>
      o.setName("category").setDescription("Category").setRequired(true)
    ),

  cmd("setcategory", "Set ticket category")
    .addChannelOption(o =>
      o.setName("category").setDescription("Category").setRequired(true)
    ),

  cmd("setstaffrole", "Set staff role")
    .addRoleOption(o =>
      o.setName("role").setDescription("Role").setRequired(true)
    ),

  cmd("setautorole", "Set automatic role")
    .addRoleOption(o =>
      o.setName("role").setDescription("Role").setRequired(true)
    ),

  cmd("setverify", "Set verification role")
    .addRoleOption(o =>
      o.setName("role").setDescription("Role").setRequired(true)
    ),

  cmd("setwelcome", "Set welcome channel")
    .addChannelOption(o =>
      o.setName("channel").setDescription("Channel").setRequired(true)
    ),

  cmd("setgoodbye", "Set goodbye channel")
    .addChannelOption(o =>
      o.setName("channel").setDescription("Channel").setRequired(true)
    )
);

/* Player */

C.push(
  cmd("player", "Show player")
    .addUserOption(o =>
      o.setName("user").setDescription("Player").setRequired(true)
    ),

  cmd("player-info", "Show player information")
    .addUserOption(o =>
      o.setName("user").setDescription("Player").setRequired(true)
    ),

  cmd("player-tickets", "Show player tickets")
    .addUserOption(o =>
      o.setName("user").setDescription("Player").setRequired(true)
    ),

  cmd("player-history", "Show player history")
    .addUserOption(o =>
      o.setName("user").setDescription("Player").setRequired(true)
    ),

  cmd("player-warnings", "Show player warnings")
    .addUserOption(o =>
      o.setName("user").setDescription("Player").setRequired(true)
    ),

  cmd("player-block", "Block player")
    .addUserOption(o =>
      o.setName("user").setDescription("Player").setRequired(true)
    ),

  cmd("player-unblock", "Unblock player")
    .addUserOption(o =>
      o.setName("user").setDescription("Player").setRequired(true)
    ),

  cmd("userinfo", "Show Discord user information")
    .addUserOption(o =>
      o.setName("user").setDescription("User").setRequired(true)
    ),

  cmd("avatar", "Show avatar")
    .addUserOption(o =>
      o.setName("user").setDescription("User").setRequired(false)
    ),

  cmd("role", "Show role")
    .addRoleOption(o =>
      o.setName("role").setDescription("Role").setRequired(true)
    ),

  cmd("addrole", "Add role")
    .addUserOption(o =>
      o.setName("user").setDescription("User").setRequired(true)
    )
    .addRoleOption(o =>
      o.setName("role").setDescription("Role").setRequired(true)
    ),

  cmd("removerole", "Remove role")
    .addUserOption(o =>
      o.setName("user").setDescription("User").setRequired(true)
    )
    .addRoleOption(o =>
      o.setName("role").setDescription("Role").setRequired(true)
    ),

  cmd("nickname", "Change nickname")
    .addUserOption(o =>
      o.setName("user").setDescription("User").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("name").setDescription("Nickname").setRequired(false)
    )
);

const COMMANDS = C.map(x => x.toJSON());

/* =========================================================
   REGISTER COMMANDS
========================================================= */

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(
      CLIENT_ID,
      SERVER_ID
    ),
    { body: COMMANDS }
  );

  console.log(
    `✅ Registered ${COMMANDS.length} slash commands.`
  );
}

/* =========================================================
   TICKET CREATION
========================================================= */

async function createTicket(i) {

  if (!i.guild) {
    return reply(i, "❌ Tickets can only be created in the server.");
  }

  const blocked = await db(
    `SELECT 1 FROM blocked_users
     WHERE guild_id=$1 AND user_id=$2`,
    [i.guild.id, i.user.id]
  );

  if (blocked.rows.length) {
    return reply(i, "🚫 You are blocked from creating support tickets.");
  }

  const existing = await db(
    `SELECT * FROM tickets
     WHERE guild_id=$1 AND user_id=$2 AND status='open'
     LIMIT 1`,
    [i.guild.id, i.user.id]
  );

  if (existing.rows.length) {
    return reply(
      i,
      `🎫 You already have an open ticket: <#${existing.rows[0].channel_id}>`
    );
  }

  const s = await settings(i.guild.id);

  let category = null;

  if (s?.ticket_category) {
    category = i.guild.channels.cache.get(s.ticket_category);
  }

  const channel = await i.guild.channels.create({
    name: `ticket-${i.user.username}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 80),

    type: ChannelType.GuildText,

    parent: category?.id || null,

    permissionOverwrites: [
      {
        id: i.guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel]
      },
      {
        id: i.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles
        ]
      },
      {
        id: SUPPORT_ADMIN_ROLE_ID,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.ManageMessages
        ]
      }
    ]
  });

  const ticket = await db(
    `INSERT INTO tickets(guild_id,user_id,channel_id)
     VALUES($1,$2,$3)
     RETURNING *`,
    [i.guild.id, i.user.id, channel.id]
  );

  const id = ticket.rows[0].id;

  await db(
    `INSERT INTO ticket_events(ticket_id,actor_id,action,details)
     VALUES($1,$2,'created','Ticket created')`,
    [id, i.user.id]
  );

  const embed = new EmbedBuilder()
    .setTitle("🎫 Grand Mafia Support")
    .setDescription(
      `Welcome <@${i.user.id}>!\n\n` +
      `Please describe your issue clearly.\n` +
      `A support member will assist you as soon as possible.`
    )
    .addFields(
      { name: "Ticket ID", value: String(id), inline: true },
      { name: "Status", value: "🟢 Open", inline: true }
    )
    .setTimestamp();

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`claim:${id}`)
      .setLabel("Claim")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(`hold:${id}`)
      .setLabel("Hold")
      .setEmoji("⏸️")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`close:${id}`)
      .setLabel("Close")
      .setEmoji("🔴")
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: `<@${i.user.id}> <@&${SUPPORT_ADMIN_ROLE_ID}>`,
    embeds: [embed],
    components: [buttons]
  });

  await reply(
    i,
    `✅ Ticket created: ${channel}`
  );

  await log(
    i.guild,
    "🎫 Ticket Created",
    `Ticket #${id} created.`,
    [
      { name: "Player", value: `<@${i.user.id}>`, inline: true },
      { name: "Channel", value: `${channel}`, inline: true }
    ]
  );
}

/* =========================================================
   GET CURRENT TICKET
========================================================= */

async function currentTicket(i) {

  if (!i.channel) return null;

  const r = await db(
    `SELECT * FROM tickets
     WHERE channel_id=$1
     ORDER BY id DESC LIMIT 1`,
    [i.channel.id]
  );

  return r.rows[0] || null;
}

/* =========================================================
   TICKET CLOSE
========================================================= */

async function closeTicket(i, reason = "Closed by staff") {

  const t = await currentTicket(i);

  if (!t) {
    return reply(i, "❌ This is not a ticket channel.");
  }

  if (!staff(i.member)) {
    return reply(i, "❌ Staff only.");
  }

  await db(
    `UPDATE tickets
     SET status='closed',
         closed_at=NOW(),
         updated_at=NOW()
     WHERE id=$1`,
    [t.id]
  );

  await db(
    `INSERT INTO ticket_events(ticket_id,actor_id,action,details)
     VALUES($1,$2,'closed',$3)`,
    [t.id, i.user.id, reason]
  );

  await log(
    i.guild,
    "🔴 Ticket Closed",
    `Ticket #${t.id} closed.`,
    [
      { name: "Staff", value: `<@${i.user.id}>`, inline: true },
      { name: "Reason", value: reason, inline: true }
    ]
  );

  await reply(i, "🔴 Ticket closed.");

  setTimeout(async () => {
    try {
      await i.channel.delete("Ticket closed");
    } catch {}
  }, 3000);
}

/* =========================================================
   MESSAGE HANDLING / AUTO MOD
========================================================= */

const spam = new Map();

const DEFAULT_BADWORDS = [
  "discord.gg/",
  "@everyone",
  "@here"
];

async function automodMessage(message) {

  if (!message.guild) return;
  if (message.author.bot) return;

  const s = await settings(message.guild.id);

  if (!s || !s.automod) return;

  const content = message.content || "";
  const lower = content.toLowerCase();

  /* Staff bypass */
  if (staff(message.member)) return;

  /* Mass mention */
  if (
    s.mentions &&
    (
      message.mentions.users.size >= 5 ||
      message.mentions.roles.size >= 5 ||
      content.includes("@everyone") ||
      content.includes("@here")
    )
  ) {

    try {
      await message.delete();

      await message.member.timeout(
        5 * 60 * 1000,
        "AutoMod: mass mention"
      );

      await modlog(
        message.guild.id,
        message.author.id,
        client.user.id,
        "automod-mass-mention",
        "Mass mention"
      );

      await log(
        message.guild,
        "🛡️ AutoMod",
        "Mass mention blocked.",
        [
          {
            name: "User",
            value: `<@${message.author.id}>`
          }
        ]
      );
    } catch {}

    return;
  }

  /* Discord invites */
  if (
    s.invites &&
    /(discord\.gg\/|discord\.com\/invite\/)/i.test(content)
  ) {

    try {
      await message.delete();

      if (s.auto_timeout) {
        await message.member.timeout(
          5 * 60 * 1000,
          "AutoMod: Discord invite"
        );
      }
    } catch {}

    return;
  }

  /* Links */
  if (
    s.links &&
    /(https?:\/\/|www\.)/i.test(content)
  ) {

    try {
      await message.delete();
    } catch {}

    return;
  }

  /* Bad words */
  if (s.badwords) {

    const words = String(s.badword_list || "")
      .split(",")
      .map(x => x.trim().toLowerCase())
      .filter(Boolean);

    if (
      words.some(word => lower.includes(word))
    ) {

      try {
        await message.delete();

        if (s.auto_timeout) {
          await message.member.timeout(
            5 * 60 * 1000,
            "AutoMod: prohibited word"
          );
        }
      } catch {}

      return;
    }
  }

  /* Spam */
  if (s.spam) {

    const now = Date.now();

    const data =
      spam.get(message.author.id) || [];

    data.push(now);

    const recent =
      data.filter(
        t => now - t < 5000
      );

    spam.set(
      message.author.id,
      recent
    );

    if (recent.length >= 6) {

      try {
        await message.member.timeout(
          5 * 60 * 1000,
          "AutoMod: spam"
        );
      } catch {}

      spam.delete(
        message.author.id
      );

      await log(
        message.guild,
        "🛡️ AutoMod",
        "Spam protection triggered.",
        [
          {
            name: "User",
            value: `<@${message.author.id}>`
          }
        ]
      );
    }
  }
}

/* =========================================================
   DM SUPPORT
========================================================= */

async function handleDM(message) {

  if (message.author.bot) return;

  const guild =
    client.guilds.cache.get(SERVER_ID);

  if (!guild) return;

  const blocked = await db(
    `SELECT 1 FROM blocked_users
     WHERE guild_id=$1 AND user_id=$2`,
    [SERVER_ID, message.author.id]
  );

  if (blocked.rows.length) {
    return message.reply(
      "🚫 You are blocked from using support."
    );
  }

  let ticket = await db(
    `SELECT * FROM tickets
     WHERE guild_id=$1
       AND user_id=$2
       AND status='open'
     ORDER BY id DESC
     LIMIT 1`,
    [SERVER_ID, message.author.id]
  );

  let row = ticket.rows[0];

  if (!row) {

    const s = await settings(SERVER_ID);

    const category =
      s?.ticket_category
        ? guild.channels.cache.get(s.ticket_category)
        : null;

    const channel =
      await guild.channels.create({
        name:
          `dm-${message.author.username}`
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "")
            .slice(0, 80),

        type: ChannelType.GuildText,

        parent: category?.id || null,

        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [
              PermissionsBitField.Flags.ViewChannel
            ]
          },
          {
            id: SUPPORT_ADMIN_ROLE_ID,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
              PermissionsBitField.Flags.AttachFiles
            ]
          }
        ]
      });

    ticket = await db(
      `INSERT INTO tickets(guild_id,user_id,channel_id)
       VALUES($1,$2,$3)
       RETURNING *`,
      [
        SERVER_ID,
        message.author.id,
        channel.id
      ]
    );

    row = ticket.rows[0];

    await channel.send({
      content:
        `<@&${SUPPORT_ADMIN_ROLE_ID}>`,
      embeds: [
        new EmbedBuilder()
          .setTitle("📨 New DM Support Ticket")
          .setDescription(
            `Player: <@${message.author.id}>\n` +
            `Ticket ID: ${row.id}`
          )
          .setTimestamp()
      ]
    });
  }

  const channel =
    guild.channels.cache.get(
      row.channel_id
    );

  if (!channel) {
    return message.reply(
      "❌ Your support ticket could not be found."
    );
  }

  const attachmentText =
    message.attachments.size
      ? [...message.attachments.values()]
          .map(a => a.url)
          .join("\n")
      : "";

  await db(
    `INSERT INTO ticket_messages
     (ticket_id,author_id,direction,content,attachments)
     VALUES($1,$2,'user',$3,$4)`,
    [
      row.id,
      message.author.id,
      message.content || "",
      attachmentText
    ]
  );

  const embed =
    new EmbedBuilder()
      .setAuthor({
        name: message.author.tag,
        iconURL: message.author.displayAvatarURL()
      })
      .setDescription(
        message.content || "*Attachment*"
      )
      .setTimestamp();

  if (attachmentText) {
    embed.addFields({
      name: "📎 Attachments",
      value: attachmentText.slice(0, 1024)
    });
  }

  await channel.send({
    embeds: [embed]
  });

  await message.reply(
    `✅ Your message has been sent to support. Ticket #${row.id}`
  );
}

/* =========================================================
   INTERACTION HANDLER
========================================================= */

client.on("interactionCreate", async interaction => {

  try {

    if (interaction.isButton()) {

      const [action, id] =
        interaction.customId.split(":");

      const ticketId =
        Number(id);

      const ticket =
        await db(
          `SELECT * FROM tickets WHERE id=$1`,
          [ticketId]
        );

      const t =
        ticket.rows[0];

      if (!t) {
        return reply(
          interaction,
          "❌ Ticket not found."
        );
      }

      if (!staff(interaction.member)) {
        return reply(
          interaction,
          "❌ Staff only."
        );
      }

      if (action === "claim") {

        await db(
          `UPDATE tickets
           SET claimed_by=$1,
               updated_at=NOW()
           WHERE id=$2`,
          [interaction.user.id, ticketId]
        );

        await db(
          `INSERT INTO ticket_events
           (ticket_id,actor_id,action,details)
           VALUES($1,$2,'claimed','Ticket claimed')`,
          [ticketId, interaction.user.id]
        );

        await activity(
          interaction.guild.id,
          interaction.user.id,
          "ticket-claim"
        );

        return reply(
          interaction,
          `🎫 Ticket claimed by ${interaction.user}.`,
          false
        );
      }

      if (action === "hold") {

        await db(
          `UPDATE tickets
           SET held=TRUE,
               updated_at=NOW()
           WHERE id=$1`,
          [ticketId]
        );

        return reply(
          interaction,
          "⏸️ Ticket placed on hold.",
          false
        );
      }

      if (action === "close") {
        return closeTicket(
          interaction,
          "Closed by staff button"
        );
      }
    }

    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
    }

  } catch (error) {

    console.error(
      "❌ Interaction error:",
      error
    );

    await reply(
      interaction,
      "❌ An unexpected error occurred."
    ).catch(() => {});
  }
});

/* =========================================================
   COMMAND HANDLER
========================================================= */

async function handleCommand(i) {

  const n = i.commandName;

  /* Ticket */

  if (n === "ticket") {
    return createTicket(i);
  }

  if (n === "ticket-close") {
    return closeTicket(
      i,
      i.options.getString("reason") || "Closed by staff"
    );
  }

  if (n === "ticket-claim") {

    if (!staff(i.member))
      return reply(i, "❌ Staff only.");

    const t = await currentTicket(i);

    if (!t)
      return reply(i, "❌ Not a ticket.");

    await db(
      `UPDATE tickets
       SET claimed_by=$1,updated_at=NOW()
       WHERE id=$2`,
      [i.user.id, t.id]
    );

    await activity(
      i.guild.id,
      i.user.id,
      "ticket-claim"
    );

    return reply(
      i,
      `🎫 Claimed by ${i.user}.`,
      false
    );
  }

  if (n === "ticket-unclaim") {

    if (!staff(i.member))
      return reply(i, "❌ Staff only.");

    const t = await currentTicket(i);

    if (!t)
      return reply(i, "❌ Not a ticket.");

    await db(
      `UPDATE tickets
       SET claimed_by=NULL,
           updated_at=NOW()
       WHERE id=$1`,
      [t.id]
    );

    return reply(
      i,
      "🎫 Ticket unclaimed.",
      false
    );
  }

  if (n === "ticket-hold") {

    if (!staff(i.member))
      return reply(i, "❌ Staff only.");

    const t = await currentTicket(i);

    if (!t)
      return reply(i, "❌ Not a ticket.");

    await db(
      `UPDATE tickets SET held=TRUE WHERE id=$1`,
      [t.id]
    );

    return reply(i, "⏸️ Ticket on hold.", false);
  }

  if (n === "ticket-resume") {

    if (!staff(i.member))
      return reply(i, "❌ Staff only.");

    const t = await currentTicket(i);

    if (!t)
      return reply(i, "❌ Not a ticket.");

    await db(
      `UPDATE tickets SET held=FALSE WHERE id=$1`,
      [t.id]
    );

    return reply(i, "▶️ Ticket resumed.", false);
  }

  if (n === "ticket-info") {

    const t = await currentTicket(i);

    if (!t)
      return reply(i, "❌ Not a ticket.");

    return reply(
      i,
      `🎫 **Ticket #${t.id}**\n` +
      `Player: <@${t.user_id}>\n` +
      `Status: ${t.status}\n` +
      `Claimed: ${t.claimed_by ? `<@${t.claimed_by}>` : "Nobody"}\n` +
      `Held: ${t.held ? "Yes" : "No"}`
    );
  }

  if (n === "ticket-note") {

    if (!staff(i.member))
      return reply(i, "❌ Staff only.");

    const t = await currentTicket(i);

    if (!t)
      return reply(i, "❌ Not a ticket.");

    const note =
      i.options.getString("note");

    await db(
      `INSERT INTO ticket_notes
       (ticket_id,staff_id,note)
       VALUES($1,$2,$3)`,
      [t.id, i.user.id, note]
    );

    return reply(i, "📝 Internal note saved.");
  }

  if (n === "ticket-notes") {

    if (!staff(i.member))
      return reply(i, "❌ Staff only.");

    const t = await currentTicket(i);

    if (!t)
      return reply(i, "❌ Not a ticket.");

    const r = await db(
      `SELECT * FROM ticket_notes
       WHERE ticket_id=$1
       ORDER BY id DESC
       LIMIT 20`,
      [t.id]
    );

    if (!r.rows.length)
      return reply(i, "📝 No internal notes.");

    return reply(
      i,
      r.rows.map(x =>
        `**${x.id}.** <@${x.staff_id}> — ${x.note}`
      ).join("\n")
    );
  }

  if (n === "ticket-history") {

    if (!staff(i.member))
      return reply(i, "❌ Staff only.");

    const t = await currentTicket(i);

    if (!t)
      return reply(i, "❌ Not a ticket.");

    const r = await db(
      `SELECT * FROM ticket_events
       WHERE ticket_id=$1
       ORDER BY id DESC
       LIMIT 20`,
      [t.id]
    );

    return reply(
      i,
      r.rows.length
        ? r.rows.map(x =>
            `**${x.action}** — ${x.details || ""} — <@${x.actor_id || "0"}>`
          ).join("\n")
        : "📋 No history."
    );
  }

  if (n === "ticket-transcript") {

    if (!staff(i.member))
      return reply(i, "❌ Staff only.");

    const t = await currentTicket(i);

    if (!t)
      return reply(i, "❌ Not a ticket.");

    const r = await db(
      `SELECT * FROM ticket_messages
       WHERE ticket_id=$1
       ORDER BY id ASC`,
      [t.id]
    );

    const text =
      r.rows.map(x =>
        `[${new Date(x.created_at).toISOString()}] ` +
        `${x.author_id}: ${x.content}\n` +
        `${x.attachments || ""}`
      ).join("\n");

    return reply(
      i,
      text
        ? `\`\`\`\n${text.slice(0, 1900)}\n\`\`\``
        : "🧾 No messages."
    );
  }

  if (n === "ticket-reopen") {

    if (!staff(i.member))
      return reply(i, "❌ Staff only.");

    const id =
      i.options.getInteger("id");

    const r = await db(
      `SELECT * FROM tickets WHERE id=$1`,
      [id]
    );

    if (!r.rows.length)
      return reply(i, "❌ Ticket not found.");

    const t = r.rows[0];

    await db(
      `UPDATE tickets
       SET status='open',
           closed_at=NULL,
           updated_at=NOW()
       WHERE id=$1`,
      [id]
    );

    return reply(
      i,
      `🔓 Ticket #${id} reopened.`
    );
  }

  if (n === "ticket-add") {

    if (!staff(i.member))
      return reply(i, "❌ Staff only.");

    const t = await currentTicket(i);

    if (!t)
      return reply(i, "❌ Not a ticket.");

    const user =
      i.options.getUser("user");

    await i.channel.permissionOverwrites.edit(
      user.id,
      {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true
      }
    );

    return reply(
      i,
      `👤 Added ${user}.`,
      false
    );
  }

  if (n === "ticket-remove") {

    if (!staff(i.member))
      return reply(i, "❌ Staff only.");

    const user =
      i.options.getUser("user");

    await i.channel.permissionOverwrites.delete(
      user.id
    );

    return reply(
      i,
      `👤 Removed ${user}.`,
      false
    );
  }

  if (n === "ticket-rename") {

    if (!staff(i.member))
      return reply(i, "❌ Staff only.");

    const name =
      i.options.getString("name");

    await i.channel.setName(
      name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .slice(0, 90)
    );

    return reply(i, "✏️ Ticket renamed.", false);
  }

  if (n === "ticket-block") {

    if (!staff(i.member))
      return reply(i, "❌ Staff only.");

    const user =
      i.options.getUser("user");

    const reason =
      i.options.getString("reason") ||
      "Support block";

    await db(
      `INSERT INTO blocked_users(guild_id,user_id,reason)
       VALUES($1,$2,$3)
       ON CONFLICT(guild_id,user_id)
       DO UPDATE SET reason=EXCLUDED.reason`,
      [
        i.guild.id,
        user.id,
        reason
      ]
    );

    return reply(
      i,
      `🚫 ${user} blocked from support.`
    );
  }

  if (n === "ticket-unblock") {

    if (!staff(i.member))
      return reply(i, "❌ Staff only.");

    const user =
      i.options.getUser("user");

    await db(
      `DELETE FROM blocked_users
       WHERE guild_id=$1 AND user_id=$2`,
      [
        i.guild.id,
        user.id
      ]
    );

    return reply(
      i,
      `🔓 ${user} unblocked.`
    );
  }

  if (n === "ticket-stats") {

    if (!staff(i.member))
      return reply(i, "❌ Staff only.");

    const r = await db(
      `SELECT
       COUNT(*) FILTER(WHERE status='open') AS open,
       COUNT(*) FILTER(WHERE status='closed') AS closed,
       COUNT(*) AS total
       FROM tickets
       WHERE guild_id=$1`,
      [i.guild.id]
    );

    const x = r.rows[0];

    return reply(
      i,
      `🎫 **Ticket Statistics**\n` +
      `Open: ${x.open}\n` +
      `Closed: ${x.closed}\n` +
      `Total: ${x.total}`
    );
  }

  if (n === "reply") {

    if (!staff(i.member))
      return reply(i, "❌ Staff only.");

    const t = await currentTicket(i);

    if (!t)
      return reply(i, "❌ Not a ticket.");

    const message =
      i.options.getString("message");

    const user =
      await client.users.fetch(t.user_id);

    await user.send(
      `📨 **Support Reply — Ticket #${t.id}**\n\n${message}`
    );

    await db(
      `INSERT INTO ticket_messages
       (ticket_id,author_id,direction,content)
       VALUES($1,$2,'staff',$3)`,
      [
        t.id,
        i.user.id,
        message
      ]
    );

    return reply(i, "✅ Reply sent.");
  }

  if (n === "dm") {

    if (!staff(i.member))
      return reply(i, "❌ Staff only.");

    const user =
      i.options.getUser("user");

    const message =
      i.options.getString("message");

    try {
      await user.send(
        `📨 **Grand Mafia Support**\n\n${message}`
      );

      await activity(
        i.guild.id,
        i.user.id,
        "dm-user"
      );

      return reply(
        i,
        `✅ DM sent to ${user}.`
      );

    } catch {
      return reply(
        i,
        "❌ Could not DM that user. Their DMs may be closed."
      );
    }
  }

  /* Moderation */

  if (n === "warn") {

    if (!moderator(i.member))
      return reply(i, "❌ Moderation permission required.");

    const user =
      i.options.getUser("user");

    const reason =
      i.options.getString("reason");

    await db(
      `INSERT INTO warnings
       (guild_id,user_id,moderator_id,reason)
       VALUES($1,$2,$3,$4)`,
      [
        i.guild.id,
        user.id,
        i.user.id,
        reason
      ]
    );

    await modlog(
      i.guild.id,
      user.id,
      i.user.id,
      "warn",
      reason
    );

    try {
      await user.send(
        `⚠️ You were warned in **${i.guild.name}**.\nReason: ${reason}`
      );
    } catch {}

    await log(
      i.guild,
      "⚠️ Warning",
      `${user} was warned.`,
      [
        {
          name: "Moderator",
          value: `<@${i.user.id}>`
        },
        {
          name: "Reason",
          value: reason
        }
      ]
    );

    return reply(
      i,
      `⚠️ ${user} has been warned.`
    );
  }

  if (n === "warnings" || n === "player-warnings") {

    const user =
      i.options.getUser("user");

    const r = await db(
      `SELECT * FROM warnings
       WHERE guild_id=$1 AND user_id=$2
       ORDER BY id DESC
       LIMIT 20`,
      [
        i.guild.id,
        user.id
      ]
    );

    if (!r.rows.length)
      return reply(
        i,
        `✅ ${user} has no warnings.`
      );

    return reply(
      i,
      r.rows.map(x =>
        `**#${x.id}** ${x.reason} — <@${x.moderator_id}>`
      ).join("\n")
    );
  }

  if (
    n === "clear" ||
    n === "purge"
  ) {

    if (!moderator(i.member))
      return reply(i, "❌ Moderation permission required.");

    const amount =
      i.options.getInteger("amount");

    const deleted =
      await i.channel.bulkDelete(
        amount,
        true
      );

    return reply(
      i,
      `🧹 Deleted ${deleted.size} messages.`
    );
  }

  if (n === "timeout") {

    if (!moderator(i.member))
      return reply(i, "❌ Moderation permission required.");

    const user =
      i.options.getUser("user");

    const member =
      await i.guild.members.fetch(user.id);

    const minutes =
      i.options.getInteger("minutes");

    const reason =
      i.options.getString("reason") ||
      "Moderator timeout";

    await member.timeout(
      minutes * 60000,
      reason
    );

    await modlog(
      i.guild.id,
      user.id,
      i.user.id,
      "timeout",
      reason
    );

    return reply(
      i,
      `⏰ ${user} timed out for ${minutes} minute(s).`
    );
  }

  if (n === "untimeout") {

    if (!moderator(i.member))
      return reply(i, "❌ Moderation permission required.");

    const user =
      i.options.getUser("user");

    const member =
      await i.guild.members.fetch(user.id);

    await member.timeout(
      null,
      "Timeout removed"
    );

    return reply(
      i,
      `▶️ Timeout removed from ${user}.`
    );
  }

  if (n === "kick") {

    if (!moderator(i.member))
      return reply(i, "❌ Moderation permission required.");

    const user =
      i.options.getUser("user");

    const member =
      await i.guild.members.fetch(user.id);

    const reason =
      i.options.getString("reason") ||
      "Moderator kick";

    await member.kick(reason);

    await modlog(
      i.guild.id,
      user.id,
      i.user.id,
      "kick",
      reason
    );

    return reply(
      i,
      `👢 ${user} kicked.`
    );
  }

  if (n === "ban" || n === "softban") {

    if (!moderator(i.member))
      return reply(i, "❌ Moderation permission required.");

    const user =
      i.options.getUser("user");

    const reason =
      i.options.getString("reason") ||
      "Moderator ban";

    await i.guild.members.ban(
      user.id,
      {
        reason,
        deleteMessageSeconds:
          n === "softban"
            ? 86400
            : 0
      }
    );

    await modlog(
      i.guild.id,
      user.id,
      i.user.id,
      n,
      reason
    );

    return reply(
      i,
      `🔨 ${user} ${n === "softban" ? "softbanned" : "banned"}.`
    );
  }

  if (n === "unban") {

    if (!moderator(i.member))
      return reply(i, "❌ Moderation permission required.");

    const id =
      i.options.getString("userid");

    await i.guild.members.unban(id);

    return reply(
      i,
      `🔓 User ${id} unbanned.`
    );
  }

  if (n === "modlogs") {

    if (!staff(i.member))
      return reply(i, "❌ Staff only.");

    const user =
      i.options.getUser("user");

    const r = await db(
      `SELECT * FROM modlogs
       WHERE guild_id=$1 AND user_id=$2
       ORDER BY id DESC
       LIMIT 20`,
      [
        i.guild.id,
        user.id
      ]
    );

    return reply(
      i,
      r.rows.length
        ? r.rows.map(x =>
            `**${x.action}** — ${x.reason || "No reason"} — <@${x.moderator_id}>`
          ).join("\n")
        : "📋 No moderation logs."
    );
  }

  if (n === "slowmode") {

    if (!manager(i.member))
      return reply(i, "❌ Manage Server permission required.");

    const seconds =
      i.options.getInteger("seconds");

    await i.channel.setRateLimitPerUser(
      seconds
    );

    return reply(
      i,
      `🐌 Slowmode set to ${seconds}s.`,
      false
    );
  }

  if (
    n === "lock" ||
    n === "unlock"
  ) {

    if (!manager(i.member))
      return reply(i, "❌ Manage Server permission required.");

    await i.channel.permissionOverwrites.edit(
      i.guild.roles.everyone,
      {
        SendMessages:
          n === "unlock"
      }
    );

    return reply(
      i,
      n === "lock"
        ? "🔒 Channel locked."
        : "🔓 Channel unlocked.",
      false
    );
  }

  /* AutoMod */

  if (n.startsWith("automod")) {

    if (!manager(i.member))
      return reply(i, "❌ Manage Server permission required.");

    if (n === "automod-status") {

      const s =
        await settings(i.guild.id);

      return reply(
        i,
        `🤖 **AutoMod**\n` +
        `Enabled: ${s.automod ? "ON" : "OFF"}\n` +
        `Spam: ${s.spam ? "ON" : "OFF"}\n` +
        `Links: ${s.links ? "ON" : "OFF"}\n` +
        `Invites: ${s.invites ? "ON" : "OFF"}\n` +
        `Mentions: ${s.mentions ? "ON" : "OFF"}\n` +
        `Bad Words: ${s.badwords ? "ON" : "OFF"}\n` +
        `Auto Timeout: ${s.auto_timeout ? "ON" : "OFF"}`
      );
    }

    const map = {
      automod: "automod",
      "automod-spam": "spam",
      "automod-links": "links",
      "automod-invites": "invites",
      "automod-mentions": "mentions",
      "automod-timeout": "auto_timeout"
    };

    if (map[n]) {

      const enabled =
        i.options.getBoolean("enabled");

      await db(
        `UPDATE settings
         SET ${map[n]}=$1
         WHERE guild_id=$2`,
        [
          enabled,
          i.guild.id
        ]
      );

      return reply(
        i,
        `✅ ${n} ${enabled ? "enabled" : "disabled"}.`
      );
    }

    if (n === "automod-words") {

      const words =
        i.options.getString("words");

      await db(
        `UPDATE settings
         SET badword_list=$1
         WHERE guild_id=$2`,
        [
          words,
          i.guild.id
        ]
      );

      return reply(
        i,
        "✅ Bad-word list updated."
      );
    }
  }

  /* Security */

  if (
    [
      "security",
      "security-status",
      "raidmode",
      "raidmode-off",
      "lockdown",
      "lockdown-off",
      "verification",
      "verification-set",
      "verification-remove",
      "antiraid",
      "antiraid-config"
    ].includes(n)
  ) {

    if (!manager(i.member))
      return reply(i, "❌ Manage Server permission required.");

    if (n === "security-status") {

      const s =
        await settings(i.guild.id);

      return reply(
        i,
        `🔐 Security\n` +
        `Anti-Raid: ${s.antiraid ? "ON" : "OFF"}\n` +
        `Lockdown: ${s.lockdown ? "ON" : "OFF"}\n` +
        `Verification: ${s.verification ? "ON" : "OFF"}`
      );
    }

    if (n === "security" || n === "antiraid") {

      const enabled =
        i.options.getBoolean("enabled");

      const field =
        n === "security"
          ? "antiraid"
          : "antiraid";

      await db(
        `UPDATE settings SET ${field}=$1 WHERE guild_id=$2`,
        [enabled, i.guild.id]
      );

      return reply(
        i,
        `🛡️ Security ${enabled ? "enabled" : "disabled"}.`
      );
    }

    if (n === "raidmode") {

      await db(
        `UPDATE settings SET antiraid=TRUE WHERE guild_id=$1`,
        [i.guild.id]
      );

      return reply(i, "🚨 Raid mode enabled.");
    }

    if (n === "raidmode-off") {

      await db(
        `UPDATE settings SET antiraid=FALSE WHERE guild_id=$1`,
        [i.guild.id]
      );

      return reply(i, "✅ Raid mode disabled.");
    }

    if (
      n === "lockdown" ||
      n === "lockdown-off"
    ) {

      const enabled =
        n === "lockdown";

      await db(
        `UPDATE settings
         SET lockdown=$1
         WHERE guild_id=$2`,
        [
          enabled,
          i.guild.id
        ]
      );

      await i.guild.channels.cache
        .filter(c =>
          c.type === ChannelType.GuildText
        )
        .forEach(async c => {
          try {
            await c.permissionOverwrites.edit(
              i.guild.roles.everyone,
              {
                SendMessages:
                  !enabled
              }
            );
          } catch {}
        });

      return reply(
        i,
        enabled
          ? "🔒 Server lockdown enabled."
          : "🔓 Server lockdown disabled."
      );
    }

    if (n === "verification") {

      const enabled =
        i.options.getBoolean("enabled");

      await db(
        `UPDATE settings
         SET verification=$1
         WHERE guild_id=$2`,
        [
          enabled,
          i.guild.id
        ]
      );

      return reply(
        i,
        `✅ Verification ${enabled ? "enabled" : "disabled"}.`
      );
    }

    if (
      n === "verification-set" ||
      n === "setverify"
    ) {

      const role =
        i.options.getRole("role");

      await db(
        `UPDATE settings
         SET verify_role=$1,
             verification=TRUE
         WHERE guild_id=$2`,
        [
          role.id,
          i.guild.id
        ]
      );

      return reply(
        i,
        `✅ Verification role set to ${role}.`
      );
    }

    if (n === "verification-remove") {

      await db(
        `UPDATE settings
         SET verify_role=NULL,
             verification=FALSE
         WHERE guild_id=$1`,
        [i.guild.id]
      );

      return reply(
        i,
        "✅ Verification removed."
      );
    }

    if (n === "antiraid-config") {

      return reply(
        i,
        "✅ Anti-raid configuration accepted. The active protection uses the configured security system."
      );
    }
  }

  /* Staff */

  if (
    [
      "admin-stats",
      "staff",
      "staff-info",
      "staff-stats",
      "staff-leaderboard",
      "activity",
      "modstats"
    ].includes(n)
  ) {

    if (!staff(i.member))
      return reply(i, "❌ Staff only.");

    if (n === "staff") {

      const members =
        i.guild.members.cache
          .filter(m => staff(m))
          .map(m => `${m} — ${m.user.tag}`)
          .slice(0, 50);

      return reply(
        i,
        members.length
          ? members.join("\n")
          : "No staff found."
      );
    }

    if (
      n === "staff-info" ||
      n === "staff-stats" ||
      n === "activity"
    ) {

      const user =
        i.options.getUser("user") ||
        i.user;

      const r =
        await db(
          `SELECT COUNT(*) AS total
           FROM staff_activity
           WHERE guild_id=$1 AND staff_id=$2`,
          [
            i.guild.id,
            user.id
          ]
        );

      return reply(
        i,
        `📊 ${user}\nActivity records: ${r.rows[0].total}`
      );
    }

    if (
      n === "admin-stats" ||
      n === "modstats"
    ) {

      const r =
        await db(
          `SELECT action,COUNT(*) AS count
           FROM modlogs
           WHERE guild_id=$1
           GROUP BY action
           ORDER BY count DESC`,
          [i.guild.id]
        );

      return reply(
        i,
        r.rows.length
          ? r.rows.map(x =>
              `${x.action}: ${x.count}`
            ).join("\n")
          : "No moderation statistics."
      );
    }

    if (n === "staff-leaderboard") {

      const r =
        await db(
          `SELECT staff_id,COUNT(*) AS count
           FROM staff_activity
           WHERE guild_id=$1
           GROUP BY staff_id
           ORDER BY count DESC
           LIMIT 10`,
          [i.guild.id]
        );

      return reply(
        i,
        r.rows.length
          ? r.rows.map((x, index) =>
              `**${index + 1}.** <@${x.staff_id}> — ${x.count}`
            ).join("\n")
          : "No activity."
      );
    }
  }

  /* Server */

  if (
    [
      "announce",
      "say",
      "embed",
      "poll"
    ].includes(n)
  ) {

    if (!manager(i.member))
      return reply(i, "❌ Manage Server permission required.");

    if (n === "announce") {

      const message =
        i.options.getString("message");

      await i.channel.send({
        content: `📢 **ANNOUNCEMENT**\n\n${message}`
      });

      return reply(i, "✅ Announcement sent.");
    }

    if (n === "say") {

      const message =
        i.options.getString("message");

      await i.channel.send({
        content: message
      });

      return reply(i, "✅ Message sent.");
    }

    if (n === "embed") {

      const title =
        i.options.getString("title");

      const description =
        i.options.getString("description");

      await i.channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setTimestamp()
        ]
      });

      return reply(i, "✅ Embed sent.");
    }

    if (n === "poll") {

      const question =
        i.options.getString("question");

      const message =
        await i.channel.send({
          content:
            `📊 **POLL**\n\n${question}\n\n👍 Yes\n👎 No`
        });

      await message.react("👍");
      await message.react("👎");

      return reply(i, "✅ Poll created.");
    }
  }

  /* Configuration */

  if (
    [
      "config-view",
      "setlogs",
      "setticket",
      "setcategory",
      "setstaffrole",
      "setautorole",
      "setverify",
      "setwelcome",
      "setgoodbye"
    ].includes(n)
  ) {

    if (!manager(i.member))
      return reply(i, "❌ Manage Server permission required.");

    if (n === "config-view") {

      const s =
        await settings(i.guild.id);

      return reply(
        i,
        `⚙️ **Configuration**\n` +
        `Ticket Category: ${s.ticket_category || "Not set"}\n` +
        `Log Channel: ${s.log_channel || SUPPORT_LOG_CHANNEL_ID}\n` +
        `Support Role: ${s.support_role || SUPPORT_ADMIN_ROLE_ID}\n` +
        `Auto Role: ${s.auto_role || "Not set"}\n` +
        `Verify Role: ${s.verify_role || "Not set"}`
      );
    }

    if (n === "setlogs") {

      const channel =
        i.options.getChannel("channel");

      await db(
        `UPDATE settings
         SET log_channel=$1
         WHERE guild_id=$2`,
        [
          channel.id,
          i.guild.id
        ]
      );

      return reply(
        i,
        `✅ Log channel set to ${channel}.`
      );
    }

    if (
      n === "setticket" ||
      n === "setcategory"
    ) {

      const category =
        i.options.getChannel("category");

      await db(
        `UPDATE settings
         SET ticket_category=$1
         WHERE guild_id=$2`,
        [
          category.id,
          i.guild.id
        ]
      );

      return reply(
        i,
        `✅ Ticket category set to ${category}.`
      );
    }

    if (n === "setstaffrole") {

      const role =
        i.options.getRole("role");

      await db(
        `UPDATE settings
         SET support_role=$1
         WHERE guild_id=$2`,
        [
          role.id,
          i.guild.id
        ]
      );

      return reply(
        i,
        `✅ Staff role set to ${role}.`
      );
    }

    if (n === "setautorole") {

      const role =
        i.options.getRole("role");

      await db(
        `UPDATE settings
         SET auto_role=$1
         WHERE guild_id=$2`,
        [
          role.id,
          i.guild.id
        ]
      );

      return reply(
        i,
        `✅ Auto role set to ${role}.`
      );
    }

    if (n === "setwelcome") {

      const channel =
        i.options.getChannel("channel");

      await db(
        `UPDATE settings
         SET welcome_channel=$1
         WHERE guild_id=$2`,
        [
          channel.id,
          i.guild.id
        ]
      );

      return reply(
        i,
        `✅ Welcome channel set to ${channel}.`
      );
    }

    if (n === "setgoodbye") {

      const channel =
        i.options.getChannel("channel");

      await db(
        `UPDATE settings
         SET goodbye_channel=$1
         WHERE guild_id=$2`,
        [
          channel.id,
          i.guild.id
        ]
      );

      return reply(
        i,
        `✅ Goodbye channel set to ${channel}.`
      );
    }
  }

  /* Player */

  if (
    [
      "player",
      "player-info",
      "userinfo",
      "avatar",
      "role",
      "player-tickets",
      "player-history",
      "player-block",
      "player-unblock",
      "addrole",
      "removerole",
      "nickname"
    ].includes(n)
  ) {

    if (
      [
        "player-block",
        "player-unblock",
        "addrole",
        "removerole",
        "nickname"
      ].includes(n) &&
      !staff(i.member)
    ) {
      return reply(i, "❌ Staff only.");
    }

    if (n === "role") {

      const role =
        i.options.getRole("role");

      return reply(
        i,
        `🎭 **${role.name}**\nID: ${role.id}\nMembers: ${role.members.size}`
      );
    }

    if (n === "avatar") {

      const user =
        i.options.getUser("user") ||
        i.user;

      return reply(
        i,
        user.displayAvatarURL({
          size: 1024
        }),
        false
      );
    }

    const user =
      i.options.getUser("user") ||
      i.user;

    if (
      n === "player" ||
      n === "player-info" ||
      n === "userinfo"
    ) {

      const member =
        await i.guild.members.fetch(user.id);

      return reply(
        i,
        `👤 **${user.tag}**\n` +
        `ID: ${user.id}\n` +
        `Joined: ${member.joinedAt?.toISOString() || "Unknown"}\n` +
        `Created: ${user.createdAt.toISOString()}\n` +
        `Roles: ${member.roles.cache.size - 1}`
      );
    }

    if (
      n === "player-tickets" ||
      n === "player-history"
    ) {

      const r =
        await db(
          `SELECT * FROM tickets
           WHERE guild_id=$1 AND user_id=$2
           ORDER BY id DESC
           LIMIT 20`,
          [
            i.guild.id,
            user.id
          ]
        );

      return reply(
        i,
        r.rows.length
          ? r.rows.map(x =>
              `#${x.id} — ${x.status}`
            ).join("\n")
          : "No tickets found."
      );
    }

    if (n === "player-block") {

      await db(
        `INSERT INTO blocked_users(guild_id,user_id,reason)
         VALUES($1,$2,'Staff block')
         ON CONFLICT(guild_id,user_id)
         DO NOTHING`,
        [
          i.guild.id,
          user.id
        ]
      );

      return reply(
        i,
        `🚫 ${user} blocked.`
      );
    }

    if (n === "player-unblock") {

      await db(
        `DELETE FROM blocked_users
         WHERE guild_id=$1 AND user_id=$2`,
        [
          i.guild.id,
          user.id
        ]
      );

      return reply(
        i,
        `🔓 ${user} unblocked.`
      );
    }

    if (n === "addrole") {

      const role =
        i.options.getRole("role");

      const member =
        await i.guild.members.fetch(user.id);

      await member.roles.add(role);

      return reply(
        i,
        `✅ Added ${role} to ${user}.`
      );
    }

    if (n === "removerole") {

      const role =
        i.options.getRole("role");

      const member =
        await i.guild.members.fetch(user.id);

      await member.roles.remove(role);

      return reply(
        i,
        `✅ Removed ${role} from ${user}.`
      );
    }

    if (n === "nickname") {

      const name =
        i.options.getString("name");

      const member =
        await i.guild.members.fetch(user.id);

      await member.setNickname(
        name || null
      );

      return reply(
        i,
        `✅ Nickname updated for ${user}.`
      );
    }
  }

  return reply(
    i,
    "❌ Command handler not found."
  );
}

/* =========================================================
   MEMBER JOIN / LEAVE
========================================================= */

client.on("guildMemberAdd", async member => {

  try {

    const s =
      await settings(member.guild.id);

    if (
      s?.auto_role
    ) {

      const role =
        member.guild.roles.cache.get(
          s.auto_role
        );

      if (role) {
        await member.roles.add(role).catch(() => {});
      }
    }

    if (
      s?.welcome_channel
    ) {

      const channel =
        member.guild.channels.cache.get(
          s.welcome_channel
        );

      if (channel) {
        await channel.send(
          `👋 Welcome ${member} to **${member.guild.name}**!`
        );
      }
    }

  } catch (e) {
    console.error("Join handler:", e.message);
  }
});

client.on("guildMemberRemove", async member => {

  try {

    const s =
      await settings(member.guild.id);

    if (
      s?.goodbye_channel
    ) {

      const channel =
        member.guild.channels.cache.get(
          s.goodbye_channel
        );

      if (channel) {
        await channel.send(
          `👋 **${member.user.tag}** has left the server.`
        );
      }
    }

  } catch (e) {
    console.error("Leave handler:", e.message);
  }
});

/* =========================================================
   MESSAGE EVENT
========================================================= */

client.on("messageCreate", async message => {

  try {

    if (!message.guild) {
      return handleDM(message);
    }

    await automodMessage(message);

    /* Save messages belonging to tickets */
    const t =
      await db(
        `SELECT * FROM tickets
         WHERE channel_id=$1
         AND status='open'
         LIMIT 1`,
        [message.channel.id]
      );

    if (t.rows.length && !message.author.bot) {

      const attachments =
        message.attachments.size
          ? [...message.attachments.values()]
              .map(a => a.url)
              .join("\n")
          : "";

      await db(
        `INSERT INTO ticket_messages
         (ticket_id,author_id,direction,content,attachments)
         VALUES($1,$2,$3,$4,$5)`,
        [
          t.rows[0].id,
          message.author.id,
          staff(message.member)
            ? "staff"
            : "user",
          message.content || "",
          attachments
        ]
      );

      await db(
        `UPDATE tickets
         SET updated_at=NOW()
         WHERE id=$1`,
        [t.rows[0].id]
      );
    }

  } catch (e) {
    console.error("Message handler:", e);
  }
});

/* =========================================================
   INACTIVITY AUTO CLOSE
========================================================= */

async function inactivityCheck() {

  try {

    const r =
      await db(`
        SELECT t.*,s.inactivity_hours
        FROM tickets t
        JOIN settings s
          ON s.guild_id=t.guild_id
        WHERE t.status='open'
          AND t.held=FALSE
          AND t.updated_at <
              NOW() -
              (s.inactivity_hours || ' hours')::interval
      `);

    for (const t of r.rows) {

      await db(
        `UPDATE tickets
         SET status='closed',
             closed_at=NOW()
         WHERE id=$1`,
        [t.id]
      );

      const guild =
        client.guilds.cache.get(
          t.guild_id
        );

      if (!guild) continue;

      const channel =
        guild.channels.cache.get(
          t.channel_id
        );

      if (channel) {

        await channel.send(
          "⏰ This ticket was automatically closed due to inactivity."
        ).catch(() => {});

        setTimeout(
          () =>
            channel.delete(
              "Automatic inactivity close"
            ).catch(() => {}),
          5000
        );
      }
    }

  } catch (e) {

    console.error(
      "Inactivity checker:",
      e.message
    );
  }
}

/* =========================================================
   READY
========================================================= */

client.once("ready", async () => {

  console.log(
    `✅ Logged in as ${client.user.tag}`
  );

  console.log(
    `🏠 Server ID: ${SERVER_ID}`
  );

  console.log(
    `🛡️ Support Role: ${SUPPORT_ADMIN_ROLE_ID}`
  );

  console.log(
    `📋 Log Channel: ${SUPPORT_LOG_CHANNEL_ID}`
  );

  try {

    await initDB();

    await registerCommands();

    console.log(
      `🚀 Grand Mafia Support Bot is online.`
    );

  } catch (e) {

    console.error(
      "❌ Startup error:",
      e
    );

    process.exit(1);
  }

  setInterval(
    inactivityCheck,
    10 * 60 * 1000
  );
});

/* =========================================================
   GLOBAL ERROR HANDLING
========================================================= */

process.on("unhandledRejection", error => {
  console.error(
    "❌ Unhandled rejection:",
    error
  );
});

process.on("uncaughtException", error => {
  console.error(
    "❌ Uncaught exception:",
    error
  );
});

/* =========================================================
   LOGIN
========================================================= */

client.login(TOKEN);
