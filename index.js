require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder
} = require("discord.js");

const { Pool } = require("pg");

// =========================
// CONFIG
// =========================

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const DATABASE_URL = process.env.DATABASE_URL;

if (!TOKEN) {
  console.error("❌ TOKEN is missing from environment variables.");
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error("❌ CLIENT_ID is missing from environment variables.");
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL is missing from environment variables.");
  process.exit(1);
}

// =========================
// DISCORD CLIENT
// =========================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.GuildMember,
    Partials.User
  ]
});

client.commands = new Collection();

// =========================
// POSTGRESQL
// =========================

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function database() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_config (
        guild_id TEXT PRIMARY KEY,
        log_channel TEXT,
        ticket_category TEXT,
        ticket_staff_role TEXT,
        mod_log_channel TEXT,
        welcome_channel TEXT,
        welcome_message TEXT,
        verification_channel TEXT,
        verification_role TEXT,
        automod_enabled BOOLEAN DEFAULT true,
        antispam_enabled BOOLEAN DEFAULT true,
        autotimeout_enabled BOOLEAN DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS warnings (
        id SERIAL PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS cases (
        id SERIAL PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        moderator_id TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT UNIQUE NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS invites (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        inviter_id TEXT,
        uses INTEGER DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS admin_activity (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        messages INTEGER DEFAULT 0,
        commands INTEGER DEFAULT 0,
        voice_minutes INTEGER DEFAULT 0,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (guild_id, user_id)
      );
    `);

    console.log("✅ PostgreSQL connected.");
  } catch (error) {
    console.error("❌ PostgreSQL connection failed:");
    console.error(error.message);
  }
}

// =========================
// HELPERS
// =========================

async function getConfig(guildId) {
  const result = await pool.query(
    "SELECT * FROM bot_config WHERE guild_id = $1",
    [guildId]
  );

  if (result.rows.length) return result.rows[0];

  await pool.query(
    "INSERT INTO bot_config (guild_id) VALUES ($1) ON CONFLICT DO NOTHING",
    [guildId]
  );

  const newResult = await pool.query(
    "SELECT * FROM bot_config WHERE guild_id = $1",
    [guildId]
  );

  return newResult.rows[0];
}

async function logAction(guild, title, description) {
  try {
    const config = await getConfig(guild.id);

    if (!config?.log_channel) return;

    const channel = guild.channels.cache.get(config.log_channel);

    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setTimestamp();

    await channel.send({ embeds: [embed] }).catch(() => {});
  } catch {}
}

async function addCase(guildId, userId, moderatorId, action, reason) {
  await pool.query(
    `INSERT INTO cases
    (guild_id, user_id, moderator_id, action, reason)
    VALUES ($1,$2,$3,$4,$5)`,
    [
      guildId,
      userId,
      moderatorId,
      action,
      reason || "No reason provided"
    ]
  );
}

async function addWarning(guildId, userId, moderatorId, reason) {
  await pool.query(
    `INSERT INTO warnings
    (guild_id, user_id, moderator_id, reason)
    VALUES ($1,$2,$3,$4)`,
    [
      guildId,
      userId,
      moderatorId,
      reason || "No reason provided"
    ]
  );
}

async function replyError(interaction, message) {
  if (interaction.replied || interaction.deferred) {
    return interaction.editReply({
      content: `❌ ${message}`
    }).catch(() => {});
  }

  return interaction.reply({
    content: `❌ ${message}`,
    ephemeral: true
  }).catch(() => {});
}

async function replySuccess(interaction, message) {
  if (interaction.replied || interaction.deferred) {
    return interaction.editReply({
      content: `✅ ${message}`
    }).catch(() => {});
  }

  return interaction.reply({
    content: `✅ ${message}`,
    ephemeral: true
  }).catch(() => {});
}

// =========================
// READY
// =========================

client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  await database();

  client.user.setActivity("Grand Mafia RP", {
    type: 3
  });

  console.log("✅ Bot is online.");
});

// =========================
// ERROR HANDLING
// =========================

client.on("error", error => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
});

// =========================
// LOGIN
// =========================

client.login(TOKEN);
