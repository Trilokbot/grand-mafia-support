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


// =========================
// PART 4 — COMMAND HANDLERS
// =========================

client.on("interactionCreate", async (interaction) => {

  // Ignore non-command interactions for now
  if (!interaction.isChatInputCommand()) return;

  const { commandName, member, guild } = interaction;

  try {

    // =========================
    // BASIC INFORMATION
    // =========================

    if (commandName === "ping") {

      const latency = Date.now() - interaction.createdTimestamp;

      return interaction.reply({
        content: `🏓 Pong!\nBot latency: **${latency}ms**`,
        ephemeral: true
      });
    }


    if (commandName === "help") {

      return interaction.reply({
        content:
`# 🤖 Bot Commands

### 📌 Information
\`/help\` \`/ping\` \`/serverinfo\` \`/userinfo\` \`/avatar\` \`/roleinfo\`

### 🛡️ Moderation
\`/ban\` \`/unban\` \`/kick\` \`/timeout\` \`/untimeout\`
\`/warn\` \`/warnings\` \`/clearwarnings\` \`/clear\`
\`/lock\` \`/unlock\` \`/slowmode\`

### 🎫 Tickets
\`/ticket\` \`/close\` \`/add\` \`/remove\`
\`/ticketpanel\` \`/ticketsetup\` \`/claim\` \`/unclaim\`

### 🤖 Auto Moderation
\`/automod\` \`/antispam\` \`/antilink\`
\`/antimention\` \`/autotimeout\` \`/filter\`

### 🔐 Security
\`/security\` \`/verification\` \`/autorole\`

### 📢 Announcements
\`/announce\` \`/embed\` \`/say\` \`/announcehere\`

### 📊 Logs
\`/setlogs\` \`/setmodlogs\` \`/logs\`

### 👑 Administration
\`/config\` \`/setup\` \`/resetconfig\`
\`/case\` \`/cases\`

### 📈 Activity
\`/activity\` \`/adminactivity\` \`/leaderboard\`

### 📨 Invites
\`/invites\` \`/inviteleaderboard\`

### 🎭 Roles
\`/addrole\` \`/removerole\` \`/nickname\`

### ⚙️ Utility
\`/channelinfo\` \`/renamechannel\` \`/servericon\`
\`/membercount\` \`/rolelist\` \`/channel-list\`
\`/remind\` \`/poll\` \`/report\` \`/suggest\`

### 🤖 Bot
\`/botinfo\` \`/uptime\` \`/stats\`
\`/reload\` \`/maintenance\``,
        ephemeral: true
      });
    }


    // =========================
    // SERVER INFO
    // =========================

    if (commandName === "serverinfo") {

      const owner = await guild.fetchOwner();

      return interaction.reply({
        embeds: [{
          title: `📊 ${guild.name}`,
          fields: [
            {
              name: "👑 Owner",
              value: `${owner.user.tag}`,
              inline: true
            },
            {
              name: "👥 Members",
              value: `${guild.memberCount}`,
              inline: true
            },
            {
              name: "🎭 Roles",
              value: `${guild.roles.cache.size}`,
              inline: true
            },
            {
              name: "💬 Channels",
              value: `${guild.channels.cache.size}`,
              inline: true
            },
            {
              name: "🆔 Server ID",
              value: guild.id,
              inline: true
            }
          ],
          timestamp: new Date().toISOString()
        }]
      });
    }


    // =========================
    // USER INFO
    // =========================

    if (commandName === "userinfo") {

      const user = interaction.options.getUser("user") || interaction.user;
      const target = await guild.members.fetch(user.id).catch(() => null);

      return interaction.reply({
        embeds: [{
          title: `👤 User Information`,
          thumbnail: {
            url: user.displayAvatarURL({ size: 1024 })
          },
          fields: [
            {
              name: "Username",
              value: user.tag,
              inline: true
            },
            {
              name: "User ID",
              value: user.id,
              inline: true
            },
            {
              name: "Bot",
              value: user.bot ? "Yes" : "No",
              inline: true
            },
            {
              name: "Joined Server",
              value: target
                ? `<t:${Math.floor(target.joinedTimestamp / 1000)}:F>`
                : "Unknown",
              inline: false
            }
          ]
        }]
      });
    }


    // =========================
    // AVATAR
    // =========================

    if (commandName === "avatar") {

      const user = interaction.options.getUser("user") || interaction.user;

      return interaction.reply({
        embeds: [{
          title: `${user.username}'s Avatar`,
          image: {
            url: user.displayAvatarURL({
              size: 4096,
              extension: "png"
            })
          }
        }]
      });
    }


    // =========================
    // ROLE INFO
    // =========================

    if (commandName === "roleinfo") {

      const role = interaction.options.getRole("role");

      return interaction.reply({
        embeds: [{
          title: `🎭 ${role.name}`,
          fields: [
            {
              name: "ID",
              value: role.id,
              inline: true
            },
            {
              name: "Members",
              value: `${role.members.size}`,
              inline: true
            },
            {
              name: "Position",
              value: `${role.position}`,
              inline: true
            },
            {
              name: "Mentionable",
              value: role.mentionable ? "Yes" : "No",
              inline: true
            }
          ]
        }]
      });
    }


    // =========================
    // MEMBER COUNT
    // =========================

    if (commandName === "membercount") {

      return interaction.reply(
        `👥 **${guild.name}** currently has **${guild.memberCount} members**.`
      );
    }


    // =========================
    // SERVER ICON
    // =========================

    if (commandName === "servericon") {

      const icon = guild.iconURL({
        size: 4096,
        extension: "png"
      });

      if (!icon) {
        return interaction.reply({
          content: "❌ This server doesn't have an icon.",
          ephemeral: true
        });
      }

      return interaction.reply({
        embeds: [{
          title: `${guild.name} — Server Icon`,
          image: {
            url: icon
          }
        }]
      });
    }


    // =========================
    // ROLE LIST
    // =========================

    if (commandName === "rolelist") {

      const roles = guild.roles.cache
        .filter(role => role.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map(role => `${role} — ${role.members.size} members`)
        .slice(0, 50);

      return interaction.reply({
        content:
          `🎭 **Server Roles**\n\n${roles.join("\n") || "No roles found."}`,
        ephemeral: true
      });
    }


    // =========================
    // CHANNEL LIST
    // =========================

    if (commandName === "channel-list") {

      const channels = guild.channels.cache
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .map(channel => `• ${channel}`)
        .slice(0, 100);

      return interaction.reply({
        content:
          `📁 **Server Channels**\n\n${channels.join("\n")}`,
        ephemeral: true
      });
    }


    // =========================
    // CHANNEL INFO
    // =========================

    if (commandName === "channelinfo") {

      const channel = interaction.channel;

      return interaction.reply({
        embeds: [{
          title: `📺 Channel Information`,
          fields: [
            {
              name: "Name",
              value: channel.name,
              inline: true
            },
            {
              name: "ID",
              value: channel.id,
              inline: true
            },
            {
              name: "Type",
              value: `${channel.type}`,
              inline: true
            },
            {
              name: "Position",
              value: `${channel.rawPosition}`,
              inline: true
            }
          ]
        }]
      });
    }


    // =========================
    // NICKNAME
    // =========================

    if (commandName === "nickname") {

      if (!member.permissions.has("ManageNicknames")) {
        return interaction.reply({
          content: "❌ You need **Manage Nicknames** permission.",
          ephemeral: true
        });
      }

      const user = interaction.options.getMember("user");
      const name = interaction.options.getString("name");

      if (!user) {
        return interaction.reply({
          content: "❌ Member not found.",
          ephemeral: true
        });
      }

      if (!user.manageable) {
        return interaction.reply({
          content: "❌ I cannot change this member's nickname.",
          ephemeral: true
        });
      }

      await user.setNickname(name);

      return interaction.reply(
        `✅ Changed ${user}'s nickname to **${name}**.`
      );
    }


    // =========================
    // RENAME CHANNEL
    // =========================

    if (commandName === "renamechannel") {

      if (!member.permissions.has("ManageChannels")) {
        return interaction.reply({
          content: "❌ You need **Manage Channels** permission.",
          ephemeral: true
        });
      }

      const name = interaction.options.getString("name");

      await interaction.channel.setName(name);

      return interaction.reply(
        `✅ Channel renamed to **${name}**.`
      );
    }


    // =========================
    // SLOWMODE
    // =========================

    if (commandName === "slowmode") {

      if (!member.permissions.has("ManageChannels")) {
        return interaction.reply({
          content: "❌ You need **Manage Channels** permission.",
          ephemeral: true
        });
      }

      const seconds = interaction.options.getInteger("seconds");

      await interaction.channel.setRateLimitPerUser(seconds);

      return interaction.reply(
        seconds === 0
          ? "✅ Slowmode disabled."
          : `✅ Slowmode set to **${seconds} seconds**.`
      );
    }


    // =========================
    // CLEAR MESSAGES
    // =========================

    if (commandName === "clear") {

      if (!member.permissions.has("ManageMessages")) {
        return interaction.reply({
          content: "❌ You need **Manage Messages** permission.",
          ephemeral: true
        });
      }

      const amount = interaction.options.getInteger("amount");

      const deleted = await interaction.channel.bulkDelete(
        amount,
        true
      );

      return interaction.reply({
        content: `🧹 Deleted **${deleted.size} messages**.`,
        ephemeral: true
      });
    }


    // =========================
    // LOCK CHANNEL
    // =========================

    if (commandName === "lock") {

      if (!member.permissions.has("ManageChannels")) {
        return interaction.reply({
          content: "❌ You need **Manage Channels** permission.",
          ephemeral: true
        });
      }

      await interaction.channel.permissionOverwrites.edit(
        guild.roles.everyone,
        {
          SendMessages: false
        }
      );

      return interaction.reply("🔒 Channel locked.");
    }


    // =========================
    // UNLOCK CHANNEL
    // =========================

    if (commandName === "unlock") {

      if (!member.permissions.has("ManageChannels")) {
        return interaction.reply({
          content: "❌ You need **Manage Channels** permission.",
          ephemeral: true
        });
      }

      await interaction.channel.permissionOverwrites.edit(
        guild.roles.everyone,
        {
          SendMessages: null
        }
      );

      return interaction.reply("🔓 Channel unlocked.");
    }


    // =========================
    // ADD ROLE
    // =========================

    if (commandName === "addrole") {

      if (!member.permissions.has("ManageRoles")) {
        return interaction.reply({
          content: "❌ You need **Manage Roles** permission.",
          ephemeral: true
        });
      }

      const user = interaction.options.getMember("user");
      const role = interaction.options.getRole("role");

      if (!user) {
        return interaction.reply({
          content: "❌ Member not found.",
          ephemeral: true
        });
      }

      if (role.position >= member.roles.highest.position) {
        return interaction.reply({
          content: "❌ You cannot manage this role.",
          ephemeral: true
        });
      }

      if (role.position >= guild.members.me.roles.highest.position) {
        return interaction.reply({
          content: "❌ My highest role is below this role.",
          ephemeral: true
        });
      }

      await user.roles.add(role);

      return interaction.reply(
        `✅ Added ${role} to **${user.user.tag}**.`
      );
    }


    // =========================
    // REMOVE ROLE
    // =========================

    if (commandName === "removerole") {

      if (!member.permissions.has("ManageRoles")) {
        return interaction.reply({
          content: "❌ You need **Manage Roles** permission.",
          ephemeral: true
        });
      }

      const user = interaction.options.getMember("user");
      const role = interaction.options.getRole("role");

      if (!user) {
        return interaction.reply({
          content: "❌ Member not found.",
          ephemeral: true
        });
      }

      if (role.position >= member.roles.highest.position) {
        return interaction.reply({
          content: "❌ You cannot manage this role.",
          ephemeral: true
        });
      }

      await user.roles.remove(role);

      return interaction.reply(
        `✅ Removed ${role} from **${user.user.tag}**.`
      );
    }


    // =========================
    // BOT INFO
    // =========================

    if (commandName === "botinfo") {

      return interaction.reply({
        embeds: [{
          title: "🤖 Bot Information",
          fields: [
            {
              name: "Bot",
              value: client.user.tag,
              inline: true
            },
            {
              name: "Servers",
              value: `${client.guilds.cache.size}`,
              inline: true
            },
            {
              name: "Users",
              value: `${client.guilds.cache.reduce(
                (total, g) => total + g.memberCount,
                0
              )}`,
              inline: true
            },
            {
              name: "Discord.js",
              value: require("discord.js").version,
              inline: true
            }
          ]
        }]
      });
    }


    // =========================
    // UPTIME
    // =========================

    if (commandName === "uptime") {

      const totalSeconds = Math.floor(client.uptime / 1000);

      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      return interaction.reply(
        `⏱️ **Bot Uptime**\n${days}d ${hours}h ${minutes}m ${seconds}s`
      );
    }


    // =========================
    // STATS
    // =========================

    if (commandName === "stats") {

      const guildCount = client.guilds.cache.size;

      const userCount = client.guilds.cache.reduce(
        (total, g) => total + g.memberCount,
        0
      );

      return interaction.reply({
        embeds: [{
          title: "📊 Bot Statistics",
          fields: [
            {
              name: "Servers",
              value: `${guildCount}`,
              inline: true
            },
            {
              name: "Users",
              value: `${userCount}`,
              inline: true
            },
            {
              name: "Commands",
              value: `${commands.length}`,
              inline: true
            }
          ]
        }]
      });
    }


    // =========================
    // UNKNOWN COMMAND
    // =========================

    return interaction.reply({
      content: "❌ This command has not been configured yet.",
      ephemeral: true
    });

  } catch (error) {

    console.error(
      `❌ Error in /${commandName}:`,
      error
    );

    if (interaction.replied || interaction.deferred) {

      await interaction.followUp({
        content: "❌ An unexpected error occurred while executing this command.",
        ephemeral: true
      }).catch(() => {});

    } else {

      await interaction.reply({
        content: "❌ An unexpected error occurred while executing this command.",
        ephemeral: true
      }).catch(() => {});
    }
  }

});


// =========================
// PART 6 — MODERATION SYSTEM
// =========================

const { PermissionFlagsBits } = require("discord.js");

async function getTargetMember(interaction, optionName = "user") {
  const user = interaction.options.getUser(optionName);
  if (!user) return null;

  return await interaction.guild.members
    .fetch(user.id)
    .catch(() => null);
}

function canModerate(interaction, target) {
  if (!target) return "❌ Member not found.";

  if (target.id === interaction.user.id) {
    return "❌ You cannot moderate yourself.";
  }

  if (target.id === interaction.guild.ownerId) {
    return "❌ You cannot moderate the server owner.";
  }

  if (
    interaction.member.id !== interaction.guild.ownerId &&
    target.roles.highest.position >= interaction.member.roles.highest.position
  ) {
    return "❌ You cannot moderate a member with an equal or higher role.";
  }

  if (
    interaction.guild.members.me &&
    target.roles.highest.position >=
      interaction.guild.members.me.roles.highest.position
  ) {
    return "❌ My highest role must be above the target member's highest role.";
  }

  return null;
}

async function sendModerationDM(member, action, reason, moderator) {
  await member.send({
    embeds: [
      {
        color: 0xff0000,
        title: `⚠️ Moderation Action: ${action}`,
        fields: [
          {
            name: "Server",
            value: member.guild.name,
            inline: true
          },
          {
            name: "Reason",
            value: reason || "No reason provided",
            inline: true
          },
          {
            name: "Moderator",
            value: moderator.tag,
            inline: true
          }
        ],
        timestamp: new Date()
      }
    ]
  }).catch(() => {});
}

// =========================
// BAN
// =========================

if (commandName === "ban") {
  if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
    return interaction.reply({
      content: "❌ You need **Ban Members** permission.",
      ephemeral: true
    });
  }

  const target = await getTargetMember(interaction);
  const error = canModerate(interaction, target);

  if (error) {
    return interaction.reply({
      content: error,
      ephemeral: true
    });
  }

  if (!target.bannable) {
    return interaction.reply({
      content: "❌ I cannot ban this member.",
      ephemeral: true
    });
  }

  const reason =
    interaction.options.getString("reason") ||
    "No reason provided";

  await sendModerationDM(
    target,
    "Ban",
    reason,
    interaction.user
  );

  await target.ban({
    reason: `${reason} | Moderator: ${interaction.user.tag}`
  });

  return interaction.reply(
    `🔨 **${target.user.tag}** has been banned.\n**Reason:** ${reason}`
  );
}

// =========================
// KICK
// =========================

if (commandName === "kick") {
  if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
    return interaction.reply({
      content: "❌ You need **Kick Members** permission.",
      ephemeral: true
    });
  }

  const target = await getTargetMember(interaction);
  const error = canModerate(interaction, target);

  if (error) {
    return interaction.reply({
      content: error,
      ephemeral: true
    });
  }

  if (!target.kickable) {
    return interaction.reply({
      content: "❌ I cannot kick this member.",
      ephemeral: true
    });
  }

  const reason =
    interaction.options.getString("reason") ||
    "No reason provided";

  await sendModerationDM(
    target,
    "Kick",
    reason,
    interaction.user
  );

  await target.kick(
    `${reason} | Moderator: ${interaction.user.tag}`
  );

  return interaction.reply(
    `👢 **${target.user.tag}** has been kicked.\n**Reason:** ${reason}`
  );
}

// =========================
// TIMEOUT
// =========================

if (commandName === "timeout") {
  if (
    !interaction.member.permissions.has(
      PermissionFlagsBits.ModerateMembers
    )
  ) {
    return interaction.reply({
      content: "❌ You need **Moderate Members** permission.",
      ephemeral: true
    });
  }

  const target = await getTargetMember(interaction);
  const error = canModerate(interaction, target);

  if (error) {
    return interaction.reply({
      content: error,
      ephemeral: true
    });
  }

  if (!target.moderatable) {
    return interaction.reply({
      content: "❌ I cannot timeout this member.",
      ephemeral: true
    });
  }

  const minutes = interaction.options.getInteger("minutes");

  const reason =
    interaction.options.getString("reason") ||
    "No reason provided";

  await sendModerationDM(
    target,
    `Timeout (${minutes} minutes)`,
    reason,
    interaction.user
  );

  await target.timeout(
    minutes * 60 * 1000,
    `${reason} | Moderator: ${interaction.user.tag}`
  );

  return interaction.reply(
    `⏳ **${target.user.tag}** has been timed out for **${minutes} minutes**.\n**Reason:** ${reason}`
  );
}

// =========================
// UNTIMEOUT
// =========================

if (commandName === "untimeout") {
  if (
    !interaction.member.permissions.has(
      PermissionFlagsBits.ModerateMembers
    )
  ) {
    return interaction.reply({
      content: "❌ You need **Moderate Members** permission.",
      ephemeral: true
    });
  }

  const target = await getTargetMember(interaction);
  const error = canModerate(interaction, target);

  if (error) {
    return interaction.reply({
      content: error,
      ephemeral: true
    });
  }

  if (!target.moderatable) {
    return interaction.reply({
      content: "❌ I cannot remove this member's timeout.",
      ephemeral: true
    });
  }

  await target.timeout(
    null,
    `Timeout removed by ${interaction.user.tag}`
  );

  return interaction.reply(
    `✅ Timeout removed from **${target.user.tag}**.`
  );
}

// =========================
// CLEAR MESSAGES
// =========================

if (commandName === "clear") {
  if (
    !interaction.member.permissions.has(
      PermissionFlagsBits.ManageMessages
    )
  ) {
    return interaction.reply({
      content: "❌ You need **Manage Messages** permission.",
      ephemeral: true
    });
  }

  const amount = interaction.options.getInteger("amount");

  if (!interaction.channel || !interaction.channel.isTextBased()) {
    return interaction.reply({
      content: "❌ This command can only be used in a text channel.",
      ephemeral: true
    });
  }

  const deleted = await interaction.channel.bulkDelete(
    amount,
    true
  );

  return interaction.reply({
    content: `🧹 Deleted **${deleted.size}** messages.`,
    ephemeral: true
  });
}

// =========================
// LOCK CHANNEL
// =========================

if (commandName === "lock") {
  if (
    !interaction.member.permissions.has(
      PermissionFlagsBits.ManageChannels
    )
  ) {
    return interaction.reply({
      content: "❌ You need **Manage Channels** permission.",
      ephemeral: true
    });
  }

  await interaction.channel.permissionOverwrites.edit(
    interaction.guild.roles.everyone,
    {
      SendMessages: false
    }
  );

  return interaction.reply(
    `🔒 ${interaction.channel} has been locked.`
  );
}

// =========================
// UNLOCK CHANNEL
// =========================

if (commandName === "unlock") {
  if (
    !interaction.member.permissions.has(
      PermissionFlagsBits.ManageChannels
    )
  ) {
    return interaction.reply({
      content: "❌ You need **Manage Channels** permission.",
      ephemeral: true
    });
  }

  await interaction.channel.permissionOverwrites.edit(
    interaction.guild.roles.everyone,
    {
      SendMessages: null
    }
  );

  return interaction.reply(
    `🔓 ${interaction.channel} has been unlocked.`
  );
}

// =========================
// SLOWMODE
// =========================

if (commandName === "slowmode") {
  if (
    !interaction.member.permissions.has(
      PermissionFlagsBits.ManageChannels
    )
  ) {
    return interaction.reply({
      content: "❌ You need **Manage Channels** permission.",
      ephemeral: true
    });
  }

  const seconds =
    interaction.options.getInteger("seconds");

  await interaction.channel.setRateLimitPerUser(seconds);

  return interaction.reply(
    seconds === 0
      ? "🚀 Slowmode disabled."
      : `🐌 Slowmode set to **${seconds} seconds**.`
  );
}
