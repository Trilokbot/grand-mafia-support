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


// =========================
// SLASH COMMANDS
// =========================

const commands = [

  // INFORMATION
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all bot commands"),

  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot latency"),

  new SlashCommandBuilder()
    .setName("serverinfo")
    .setDescription("Show server information"),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Show user information")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User to inspect")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Show a user's avatar")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("roleinfo")
    .setDescription("Show role information")
    .addRoleOption(o =>
      o.setName("role")
        .setDescription("Role")
        .setRequired(true)
    ),

  // MODERATION
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a user")
    .addStringOption(o => o.setName("userid").setDescription("User ID").setRequired(true)),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a member")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addIntegerOption(o =>
      o.setName("minutes")
        .setDescription("Timeout duration")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320)
    )
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),

  new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Remove a timeout")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true)),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true)),

  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("Show member warnings")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true)),

  new SlashCommandBuilder()
    .setName("clearwarnings")
    .setDescription("Clear member warnings")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true)),

  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Delete messages")
    .addIntegerOption(o =>
      o.setName("amount")
        .setDescription("Number of messages")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    ),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Lock the current channel"),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Unlock the current channel"),

  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Set channel slowmode")
    .addIntegerOption(o =>
      o.setName("seconds")
        .setDescription("Seconds")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(21600)
    ),

  // TICKETS
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Create a support ticket"),

  new SlashCommandBuilder()
    .setName("close")
    .setDescription("Close the current ticket"),

  new SlashCommandBuilder()
    .setName("add")
    .setDescription("Add a member to the ticket")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true)),

  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a member from the ticket")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true)),

  new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription("Create a ticket panel"),

  new SlashCommandBuilder()
    .setName("ticketsetup")
    .setDescription("Configure ticket system"),

  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim a ticket"),

  new SlashCommandBuilder()
    .setName("unclaim")
    .setDescription("Unclaim a ticket"),

  // AUTOMOD
  new SlashCommandBuilder()
    .setName("automod")
    .setDescription("Configure automod")
    .addBooleanOption(o =>
      o.setName("enabled")
        .setDescription("Enable or disable")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("antispam")
    .setDescription("Configure anti-spam")
    .addBooleanOption(o =>
      o.setName("enabled")
        .setDescription("Enable or disable")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("antilink")
    .setDescription("Configure anti-link")
    .addBooleanOption(o =>
      o.setName("enabled")
        .setDescription("Enable or disable")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("antimention")
    .setDescription("Configure anti-mass-mention")
    .addBooleanOption(o =>
      o.setName("enabled")
        .setDescription("Enable or disable")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("autotimeout")
    .setDescription("Configure automatic timeout")
    .addBooleanOption(o =>
      o.setName("enabled")
        .setDescription("Enable or disable")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("filter")
    .setDescription("Manage word filtering")
    .addStringOption(o =>
      o.setName("action")
        .setDescription("Action")
        .setRequired(true)
        .addChoices(
          { name: "add", value: "add" },
          { name: "remove", value: "remove" }
        )
    )
    .addStringOption(o =>
      o.setName("word")
        .setDescription("Word")
        .setRequired(true)
    ),

  // SECURITY
  new SlashCommandBuilder()
    .setName("security")
    .setDescription("Configure security system")
    .addBooleanOption(o =>
      o.setName("enabled")
        .setDescription("Enable or disable")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("verification")
    .setDescription("Configure verification")
    .addBooleanOption(o =>
      o.setName("enabled")
        .setDescription("Enable or disable")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("autorole")
    .setDescription("Set automatic member role")
    .addRoleOption(o =>
      o.setName("role")
        .setDescription("Role")
        .setRequired(true)
    ),

  // ANNOUNCEMENTS
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Send an announcement")
    .addStringOption(o =>
      o.setName("message")
        .setDescription("Announcement")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Send an embed")
    .addStringOption(o =>
      o.setName("title")
        .setDescription("Title")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("description")
        .setDescription("Description")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Send a message")
    .addStringOption(o =>
      o.setName("message")
        .setDescription("Message")
        .setRequired(true)
    ),

  // LOGGING
  new SlashCommandBuilder()
    .setName("setlogs")
    .setDescription("Set log channel")
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Log channel")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setmodlogs")
    .setDescription("Set moderation log channel")
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Channel")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("logs")
    .setDescription("Show logging configuration"),

  // ADMIN / CONFIG
  new SlashCommandBuilder()
    .setName("config")
    .setDescription("Show bot configuration"),

  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Run basic server setup"),

  new SlashCommandBuilder()
    .setName("resetconfig")
    .setDescription("Reset bot configuration"),

  new SlashCommandBuilder()
    .setName("case")
    .setDescription("View a moderation case")
    .addIntegerOption(o =>
      o.setName("id")
        .setDescription("Case ID")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("cases")
    .setDescription("Show moderation cases")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    ),

  // ADMIN ACTIVITY
  new SlashCommandBuilder()
    .setName("activity")
    .setDescription("Show member activity")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("adminactivity")
    .setDescription("Show admin activity"),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show activity leaderboard"),

  // INVITES
  new SlashCommandBuilder()
    .setName("invites")
    .setDescription("Show invite statistics")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("inviteleaderboard")
    .setDescription("Show invite leaderboard"),

  // ROLE MANAGEMENT
  new SlashCommandBuilder()
    .setName("addrole")
    .setDescription("Add a role")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true)),

  new SlashCommandBuilder()
    .setName("removerole")
    .setDescription("Remove a role")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true)),

  new SlashCommandBuilder()
    .setName("nickname")
    .setDescription("Change member nickname")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption(o => o.setName("name").setDescription("Nickname").setRequired(true)),

  // CHANNEL MANAGEMENT
  new SlashCommandBuilder()
    .setName("channelinfo")
    .setDescription("Show channel information"),

  new SlashCommandBuilder()
    .setName("renamechannel")
    .setDescription("Rename current channel")
    .addStringOption(o =>
      o.setName("name")
        .setDescription("New name")
        .setRequired(true)
    ),

  // SERVER MANAGEMENT
  new SlashCommandBuilder()
    .setName("servericon")
    .setDescription("Show server icon"),

  new SlashCommandBuilder()
    .setName("membercount")
    .setDescription("Show member count"),

  new SlashCommandBuilder()
    .setName("rolelist")
    .setDescription("Show server roles"),

  new SlashCommandBuilder()
    .setName("channel-list")
    .setDescription("Show server channels"),

  // UTILITY
  new SlashCommandBuilder()
    .setName("remind")
    .setDescription("Create a reminder")
    .addIntegerOption(o =>
      o.setName("minutes")
        .setDescription("Minutes")
        .setRequired(true)
        .setMinValue(1)
    )
    .addStringOption(o =>
      o.setName("message")
        .setDescription("Reminder")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Create a poll")
    .addStringOption(o =>
      o.setName("question")
        .setDescription("Question")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("announcehere")
    .setDescription("Announcement in current channel"),

  new SlashCommandBuilder()
    .setName("report")
    .setDescription("Report a member")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("Submit a suggestion")
    .addStringOption(o =>
      o.setName("suggestion")
        .setDescription("Suggestion")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("botinfo")
    .setDescription("Show bot information"),

  new SlashCommandBuilder()
    .setName("uptime")
    .setDescription("Show bot uptime"),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show bot statistics"),

  new SlashCommandBuilder()
    .setName("reload")
    .setDescription("Reload bot configuration"),

  new SlashCommandBuilder()
    .setName("maintenance")
    .setDescription("Toggle maintenance mode")
    .addBooleanOption(o =>
      o.setName("enabled")
        .setDescription("Enable or disable")
        .setRequired(true)
    )

].map(command => command.toJSON());


// =========================
// REGISTER COMMANDS
// =========================

client.once("ready", async () => {

  try {

    await client.application.commands.set(commands);

    console.log(`✅ ${commands.length} slash commands registered.`);

  } catch (error) {

    console.error("❌ Slash command registration failed:");
    console.error(error);

  }

});
