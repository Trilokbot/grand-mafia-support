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

// =========================
// PART 7 — TICKET SYSTEM
// =========================

const {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require("discord.js");

// Ticket category name
const TICKET_CATEGORY = "TICKETS";

// Support role name
const SUPPORT_ROLE = "Support Team";

// =========================
// /ticket
// =========================

if (commandName === "ticket") {

  const guild = interaction.guild;

  // Check if user already has a ticket
  const existingTicket = guild.channels.cache.find(
    channel =>
      channel.type === ChannelType.GuildText &&
      channel.topic === `ticket-owner:${interaction.user.id}`
  );

  if (existingTicket) {
    return interaction.reply({
      content: `❌ You already have an open ticket: ${existingTicket}`,
      ephemeral: true
    });
  }

  // Find or create category
  let category = guild.channels.cache.find(
    channel =>
      channel.type === ChannelType.GuildCategory &&
      channel.name.toLowerCase() === TICKET_CATEGORY.toLowerCase()
  );

  if (!category) {
    category = await guild.channels.create({
      name: TICKET_CATEGORY,
      type: ChannelType.GuildCategory
    });
  }

  // Find support role
  const supportRole = guild.roles.cache.find(
    role =>
      role.name.toLowerCase() === SUPPORT_ROLE.toLowerCase()
  );

  const permissionOverwrites = [
    {
      id: guild.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]
    },
    {
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels
      ]
    }
  ];

  if (supportRole) {
    permissionOverwrites.push({
      id: supportRole.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]
    });
  }

  const ticket = await guild.channels.create({
    name: `ticket-${interaction.user.username}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 90),

    type: ChannelType.GuildText,

    parent: category.id,

    topic: `ticket-owner:${interaction.user.id}`,

    permissionOverwrites
  });

  const closeButton = new ButtonBuilder()
    .setCustomId("ticket_close")
    .setLabel("Close Ticket")
    .setEmoji("🔒")
    .setStyle(ButtonStyle.Danger);

  const claimButton = new ButtonBuilder()
    .setCustomId("ticket_claim")
    .setLabel("Claim")
    .setEmoji("🎫")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder()
    .addComponents(closeButton, claimButton);

  const embed = new EmbedBuilder()
    .setTitle("🎫 Support Ticket")
    .setDescription(
      `Welcome <@${interaction.user.id}>!\n\n` +
      `Please explain your issue clearly and wait for a member of the **Support Team**.\n\n` +
      `🔒 Use **Close Ticket** when your issue has been resolved.\n` +
      `🎫 Staff can use **Claim** to take responsibility for this ticket.`
    )
    .setColor(0x5865f2)
    .setTimestamp();

  await ticket.send({
    content: supportRole
      ? `${interaction.user} ${supportRole}`
      : `${interaction.user}`,
    embeds: [embed],
    components: [row]
  });

  return interaction.reply({
    content: `✅ Your ticket has been created: ${ticket}`,
    ephemeral: true
  });
}


// =========================
// /close
// =========================

if (commandName === "close") {

  const channel = interaction.channel;

  if (
    !channel ||
    channel.type !== ChannelType.GuildText ||
    !channel.topic?.startsWith("ticket-owner:")
  ) {
    return interaction.reply({
      content: "❌ This command can only be used inside a ticket.",
      ephemeral: true
    });
  }

  const ownerId = channel.topic.split(":")[1];

  const isOwner = interaction.user.id === ownerId;

  const isStaff =
    interaction.member.permissions.has(
      PermissionFlagsBits.ManageChannels
    );

  if (!isOwner && !isStaff) {
    return interaction.reply({
      content: "❌ Only the ticket owner or staff can close this ticket.",
      ephemeral: true
    });
  }

  await interaction.reply("🔒 Ticket will be deleted in **5 seconds**.");

  setTimeout(async () => {
    await channel.delete("Ticket closed").catch(() => {});
  }, 5000);

  return;
}


// =========================
// /add
// =========================

if (commandName === "add") {

  const channel = interaction.channel;

  if (
    !channel ||
    channel.type !== ChannelType.GuildText ||
    !channel.topic?.startsWith("ticket-owner:")
  ) {
    return interaction.reply({
      content: "❌ This command can only be used inside a ticket.",
      ephemeral: true
    });
  }

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

  const user = interaction.options.getUser("user");

  await channel.permissionOverwrites.edit(user.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true
  });

  return interaction.reply(
    `✅ Added **${user.tag}** to the ticket.`
  );
}


// =========================
// /remove
// =========================

if (commandName === "remove") {

  const channel = interaction.channel;

  if (
    !channel ||
    channel.type !== ChannelType.GuildText ||
    !channel.topic?.startsWith("ticket-owner:")
  ) {
    return interaction.reply({
      content: "❌ This command can only be used inside a ticket.",
      ephemeral: true
    });
  }

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

  const user = interaction.options.getUser("user");

  const ownerId = channel.topic.split(":")[1];

  if (user.id === ownerId) {
    return interaction.reply({
      content: "❌ You cannot remove the ticket owner.",
      ephemeral: true
    });
  }

  await channel.permissionOverwrites.delete(user.id);

  return interaction.reply(
    `✅ Removed **${user.tag}** from the ticket.`
  );
}


// =========================
// /claim
// =========================

if (commandName === "claim") {

  const channel = interaction.channel;

  if (
    !channel ||
    channel.type !== ChannelType.GuildText ||
    !channel.topic?.startsWith("ticket-owner:")
  ) {
    return interaction.reply({
      content: "❌ This command can only be used inside a ticket.",
      ephemeral: true
    });
  }

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

  const claimedBy = channel.topic.match(/claimed-by:(\d+)/);

  if (claimedBy) {
    return interaction.reply({
      content: `❌ This ticket is already claimed by <@${claimedBy[1]}>.`,
      ephemeral: true
    });
  }

  const ownerId = channel.topic.split(":")[1];

  await channel.setTopic(
    `ticket-owner:${ownerId}|claimed-by:${interaction.user.id}`
  );

  return interaction.reply(
    `🎫 **${interaction.user.tag}** has claimed this ticket.`
  );
}


// =========================
// /unclaim
// =========================

if (commandName === "unclaim") {

  const channel = interaction.channel;

  if (
    !channel ||
    channel.type !== ChannelType.GuildText ||
    !channel.topic?.startsWith("ticket-owner:")
  ) {
    return interaction.reply({
      content: "❌ This command can only be used inside a ticket.",
      ephemeral: true
    });
  }

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

  const ownerId = channel.topic.split("|")[0].split(":")[1];

  const claimedBy = channel.topic.match(/claimed-by:(\d+)/);

  if (!claimedBy) {
    return interaction.reply({
      content: "❌ This ticket is not currently claimed.",
      ephemeral: true
    });
  }

  if (
    claimedBy[1] !== interaction.user.id &&
    interaction.user.id !== guild?.ownerId
  ) {
    return interaction.reply({
      content: "❌ Only the staff member who claimed this ticket can unclaim it.",
      ephemeral: true
    });
  }

  await channel.setTopic(`ticket-owner:${ownerId}`);

  return interaction.reply(
    `✅ **${interaction.user.tag}** has unclaimed this ticket.`
  );
}


// =========================
// /ticketpanel
// =========================

if (commandName === "ticketpanel") {

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

  const button = new ButtonBuilder()
    .setCustomId("ticket_create")
    .setLabel("Create Ticket")
    .setEmoji("🎫")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder()
    .addComponents(button);

  const embed = new EmbedBuilder()
    .setTitle("🎫 Grand Mafia Support")
    .setDescription(
      "Need help? Click **Create Ticket** below to open a private support ticket."
    )
    .setColor(0x5865f2);

  await interaction.channel.send({
    embeds: [embed],
    components: [row]
  });

  return interaction.reply({
    content: "✅ Ticket panel created.",
    ephemeral: true
  });
}


// =========================
// /ticketsetup
// =========================

if (commandName === "ticketsetup") {

  if (
    !interaction.member.permissions.has(
      PermissionFlagsBits.Administrator
    )
  ) {
    return interaction.reply({
      content: "❌ You need **Administrator** permission.",
      ephemeral: true
    });
  }

  let category = interaction.guild.channels.cache.find(
    channel =>
      channel.type === ChannelType.GuildCategory &&
      channel.name.toLowerCase() === TICKET_CATEGORY.toLowerCase()
  );

  if (!category) {
    category = await interaction.guild.channels.create({
      name: TICKET_CATEGORY,
      type: ChannelType.GuildCategory
    });
  }

  let supportRole = interaction.guild.roles.cache.find(
    role =>
      role.name.toLowerCase() === SUPPORT_ROLE.toLowerCase()
  );

  if (!supportRole) {
    supportRole = await interaction.guild.roles.create({
      name: SUPPORT_ROLE,
      reason: "Ticket system setup"
    });
  }

  return interaction.reply({
    content:
      `✅ Ticket system configured.\n` +
      `📁 Category: ${category}\n` +
      `👥 Support Role: ${supportRole}`,
    ephemeral: true
  });
}


// =========================
// TICKET BUTTONS
// =========================

if (interaction.isButton()) {

  // CREATE TICKET BUTTON
  if (interaction.customId === "ticket_create") {

    const guild = interaction.guild;

    const existingTicket = guild.channels.cache.find(
      channel =>
        channel.type === ChannelType.GuildText &&
        channel.topic === `ticket-owner:${interaction.user.id}`
    );

    if (existingTicket) {
      return interaction.reply({
        content: `❌ You already have an open ticket: ${existingTicket}`,
        ephemeral: true
      });
    }

    let category = guild.channels.cache.find(
      channel =>
        channel.type === ChannelType.GuildCategory &&
        channel.name.toLowerCase() === TICKET_CATEGORY.toLowerCase()
    );

    if (!category) {
      category = await guild.channels.create({
        name: TICKET_CATEGORY,
        type: ChannelType.GuildCategory
      });
    }

    const supportRole = guild.roles.cache.find(
      role =>
        role.name.toLowerCase() === SUPPORT_ROLE.toLowerCase()
    );

    const permissions = [
      {
        id: guild.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      },
      {
        id: guild.members.me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels
        ]
      }
    ];

    if (supportRole) {
      permissions.push({
        id: supportRole.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      });
    }

    const ticket = await guild.channels.create({
      name: `ticket-${interaction.user.username}`
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "")
        .slice(0, 90),

      type: ChannelType.GuildText,

      parent: category.id,

      topic: `ticket-owner:${interaction.user.id}`,

      permissionOverwrites: permissions
    });

    const close = new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("Close Ticket")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger);

    const claim = new ButtonBuilder()
      .setCustomId("ticket_claim")
      .setLabel("Claim")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder()
      .addComponents(close, claim);

    await ticket.send({
      content: `${interaction.user}`,
      embeds: [
        new EmbedBuilder()
          .setTitle("🎫 Support Ticket")
          .setDescription(
            "Please explain your issue. A support member will assist you shortly."
          )
          .setColor(0x5865f2)
      ],
      components: [row]
    });

    return interaction.reply({
      content: `✅ Ticket created: ${ticket}`,
      ephemeral: true
    });
  }


  // CLOSE BUTTON
  if (interaction.customId === "ticket_close") {

    const channel = interaction.channel;

    if (
      !channel ||
      !channel.topic?.startsWith("ticket-owner:")
    ) {
      return interaction.reply({
        content: "❌ This is not a ticket.",
        ephemeral: true
      });
    }

    const ownerId =
      channel.topic.split("|")[0].split(":")[1];

    const isOwner =
      interaction.user.id === ownerId;

    const isStaff =
      interaction.member.permissions.has(
        PermissionFlagsBits.ManageChannels
      );

    if (!isOwner && !isStaff) {
      return interaction.reply({
        content: "❌ You cannot close this ticket.",
        ephemeral: true
      });
    }

    await interaction.reply(
      "🔒 Ticket closing in **5 seconds**..."
    );

    setTimeout(() => {
      channel.delete("Ticket closed").catch(() => {});
    }, 5000);

    return;
  }


  // CLAIM BUTTON
  if (interaction.customId === "ticket_claim") {

    const channel = interaction.channel;

    if (
      !channel ||
      !channel.topic?.startsWith("ticket-owner:")
    ) {
      return interaction.reply({
        content: "❌ This is not a ticket.",
        ephemeral: true
      });
    }

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

    if (channel.topic.includes("|claimed-by:")) {
      return interaction.reply({
        content: "❌ This ticket is already claimed.",
        ephemeral: true
      });
    }

    await channel.setTopic(
      `${channel.topic}|claimed-by:${interaction.user.id}`
    );

    return interaction.reply(
      `🎫 **${interaction.user.tag}** claimed this ticket.`
    );
  }
}


// =========================
// PART 8 — AUTOMOD SYSTEM
// =========================

const automodConfig = new Map();
const spamTracker = new Map();
const warnedUsers = new Map();

const DEFAULT_AUTOMOD = {
  automod: false,
  antispam: false,
  antilink: false,
  antimention: false,
  autotimeout: false,
  filteredWords: []
};

function getAutomodConfig(guildId) {
  if (!automodConfig.has(guildId)) {
    automodConfig.set(guildId, {
      ...DEFAULT_AUTOMOD,
      filteredWords: []
    });
  }

  return automodConfig.get(guildId);
}

function getUserSpamData(guildId, userId) {
  const key = `${guildId}:${userId}`;

  if (!spamTracker.has(key)) {
    spamTracker.set(key, {
      messages: [],
      warnings: 0,
      lastAction: 0
    });
  }

  return spamTracker.get(key);
}

function containsLink(content) {
  return /(https?:\/\/|www\.|discord\.gg\/|discord\.com\/invite\/)/i.test(
    content
  );
}

function containsMassMention(message) {
  const everyone =
    message.mentions.everyone === true;

  const users =
    message.mentions.users?.size || 0;

  return everyone || users >= 5;
}

function containsFilteredWord(content, words) {
  const text = content.toLowerCase();

  return words.find(word =>
    text.includes(word.toLowerCase())
  );
    }


// =========================
// /automod
// =========================

if (commandName === "automod") {

  if (
    !interaction.member.permissions.has(
      PermissionFlagsBits.ManageGuild
    )
  ) {
    return interaction.reply({
      content: "❌ You need **Manage Server** permission.",
      ephemeral: true
    });
  }

  const enabled =
    interaction.options.getBoolean("enabled");

  const config =
    getAutomodConfig(interaction.guild.id);

  config.automod = enabled;

  return interaction.reply({
    content:
      enabled
        ? "✅ **AutoMod enabled.**"
        : "🔴 **AutoMod disabled.**",
    ephemeral: true
  });
}


// =========================
// /antispam
// =========================

if (commandName === "antispam") {

  if (
    !interaction.member.permissions.has(
      PermissionFlagsBits.ManageGuild
    )
  ) {
    return interaction.reply({
      content: "❌ You need **Manage Server** permission.",
      ephemeral: true
    });
  }

  const enabled =
    interaction.options.getBoolean("enabled");

  const config =
    getAutomodConfig(interaction.guild.id);

  config.antispam = enabled;

  return interaction.reply({
    content:
      enabled
        ? "✅ **Anti-Spam enabled.**"
        : "🔴 **Anti-Spam disabled.**",
    ephemeral: true
  });
}


// =========================
// /antilink
// =========================

if (commandName === "antilink") {

  if (
    !interaction.member.permissions.has(
      PermissionFlagsBits.ManageGuild
    )
  ) {
    return interaction.reply({
      content: "❌ You need **Manage Server** permission.",
      ephemeral: true
    });
  }

  const enabled =
    interaction.options.getBoolean("enabled");

  const config =
    getAutomodConfig(interaction.guild.id);

  config.antilink = enabled;

  return interaction.reply({
    content:
      enabled
        ? "✅ **Anti-Link enabled.**"
        : "🔴 **Anti-Link disabled.**",
    ephemeral: true
  });
}


// =========================
// /antimention
// =========================

if (commandName === "antimention") {

  if (
    !interaction.member.permissions.has(
      PermissionFlagsBits.ManageGuild
    )
  ) {
    return interaction.reply({
      content: "❌ You need **Manage Server** permission.",
      ephemeral: true
    });
  }

  const enabled =
    interaction.options.getBoolean("enabled");

  const config =
    getAutomodConfig(interaction.guild.id);

  config.antimention = enabled;

  return interaction.reply({
    content:
      enabled
        ? "✅ **Anti-Mass-Mention enabled.**"
        : "🔴 **Anti-Mass-Mention disabled.**",
    ephemeral: true
  });
}


// =========================
// /autotimeout
// =========================

if (commandName === "autotimeout") {

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

  const enabled =
    interaction.options.getBoolean("enabled");

  const config =
    getAutomodConfig(interaction.guild.id);

  config.autotimeout = enabled;

  return interaction.reply({
    content:
      enabled
        ? "✅ **Automatic Timeout enabled.**"
        : "🔴 **Automatic Timeout disabled.**",
    ephemeral: true
  });
}


// =========================
// /filter
// =========================

if (commandName === "filter") {

  if (
    !interaction.member.permissions.has(
      PermissionFlagsBits.ManageGuild
    )
  ) {
    return interaction.reply({
      content: "❌ You need **Manage Server** permission.",
      ephemeral: true
    });
  }

  const action =
    interaction.options.getString("action");

  const word =
    interaction.options
      .getString("word")
      .trim()
      .toLowerCase();

  const config =
    getAutomodConfig(interaction.guild.id);

  if (action === "add") {

    if (config.filteredWords.includes(word)) {
      return interaction.reply({
        content: "⚠️ That word is already filtered.",
        ephemeral: true
      });
    }

    config.filteredWords.push(word);

    return interaction.reply({
      content: `✅ Added \`${word}\` to the AutoMod filter.`,
      ephemeral: true
    });
  }

  if (action === "remove") {

    const index =
      config.filteredWords.indexOf(word);

    if (index === -1) {
      return interaction.reply({
        content: "❌ That word is not in the filter.",
        ephemeral: true
      });
    }

    config.filteredWords.splice(index, 1);

    return interaction.reply({
      content: `✅ Removed \`${word}\` from the AutoMod filter.`,
      ephemeral: true
    });
  }
      }

// =========================
// AUTOMOD MESSAGE HANDLER
// =========================

client.on("messageCreate", async message => {

  try {

    if (!message.guild) return;

    if (message.author.bot) return;

    const config =
      getAutomodConfig(message.guild.id);

    // AutoMod completely disabled
    if (!config.automod) return;

    const member = message.member;

    if (!member) return;

    // Ignore administrators
    if (
      member.permissions.has(
        PermissionFlagsBits.Administrator
      )
    ) {
      return;
    }

    // =========================
    // FILTERED WORDS
    // =========================

    const filteredWord =
      containsFilteredWord(
        message.content,
        config.filteredWords
      );

    if (filteredWord) {

      await message.delete().catch(() => {});

      await message.channel.send({
        content:
          `⚠️ ${message.author}, your message was removed because it contained a prohibited word.`
      }).then(msg => {
        setTimeout(() => {
          msg.delete().catch(() => {});
        }, 5000);
      }).catch(() => {});

      return;
    }

    // =========================
    // ANTI-LINK
    // =========================

    if (
      config.antilink &&
      containsLink(message.content)
    ) {

      await message.delete().catch(() => {});

      await message.channel.send({
        content:
          `🔗 ${message.author}, links are not allowed here.`
      }).then(msg => {
        setTimeout(() => {
          msg.delete().catch(() => {});
        }, 5000);
      }).catch(() => {});

      return;
    }

    // =========================
    // ANTI-MASS-MENTION
    // =========================

    if (
      config.antimention &&
      containsMassMention(message)
    ) {

      await message.delete().catch(() => {});

      if (
        config.autotimeout &&
        member.moderatable
      ) {

        await member.timeout(
          5 * 60 * 1000,
          "AutoMod: mass mention"
        ).catch(() => {});
      }

      await message.channel.send({
        content:
          `🚨 ${message.author}, mass mentions are not allowed.`
      }).then(msg => {
        setTimeout(() => {
          msg.delete().catch(() => {});
        }, 5000);
      }).catch(() => {});

      return;
    }

    // =========================
    // ANTI-SPAM
    // =========================

    if (config.antispam) {

      const data =
        getUserSpamData(
          message.guild.id,
          message.author.id
        );

      const now = Date.now();

      data.messages =
        data.messages.filter(
          timestamp => now - timestamp < 5000
        );

      data.messages.push(now);

      // More than 6 messages in 5 seconds
      if (data.messages.length >= 6) {

        data.messages = [];

        await message.delete().catch(() => {});

        if (
          config.autotimeout &&
          member.moderatable &&
          now - data.lastAction > 10000
        ) {

          data.lastAction = now;

          await member.timeout(
            5 * 60 * 1000,
            "AutoMod: spam"
          ).catch(() => {});

          await message.channel.send({
            content:
              `⏳ ${message.author} has been automatically timed out for spam.`
          }).then(msg => {
            setTimeout(() => {
              msg.delete().catch(() => {});
            }, 5000);
          }).catch(() => {});

        } else {

          await message.channel.send({
            content:
              `⚠️ ${message.author}, please slow down. Spam is not allowed.`
          }).then(msg => {
            setTimeout(() => {
              msg.delete().catch(() => {});
            }, 5000);
          }).catch(() => {});
        }

        return;
      }
    }

  } catch (error) {

    console.error(
      "❌ AutoMod error:",
      error
    );

  }

});


// ============================================================
// PART 9 — SECURITY + VERIFICATION + AUTO ROLE
// ============================================================

const securityCache = new Map();
const verificationCache = new Map();
const autoRoleCache = new Map();

async function ensureSecurityTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS security_config (
        guild_id VARCHAR(30) PRIMARY KEY,
        enabled BOOLEAN DEFAULT FALSE,
        verification_enabled BOOLEAN DEFAULT FALSE,
        verification_role_id VARCHAR(30),
        autorole_id VARCHAR(30),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (error) {
    console.error("❌ Security table error:", error.message);
  }
}

async function getSecurityConfig(guildId) {
  if (securityCache.has(guildId)) {
    return securityCache.get(guildId);
  }

  const result = await pool.query(
    `SELECT * FROM security_config WHERE guild_id = $1`,
    [guildId]
  );

  if (result.rows.length === 0) {
    const created = await pool.query(
      `INSERT INTO security_config (guild_id)
       VALUES ($1)
       RETURNING *`,
      [guildId]
    );

    securityCache.set(guildId, created.rows[0]);
    return created.rows[0];
  }

  securityCache.set(guildId, result.rows[0]);
  return result.rows[0];
}

async function updateSecurityConfig(guildId, data) {
  const current = await getSecurityConfig(guildId);

  const updated = {
    enabled:
      data.enabled !== undefined ? data.enabled : current.enabled,

    verification_enabled:
      data.verification_enabled !== undefined
        ? data.verification_enabled
        : current.verification_enabled,

    verification_role_id:
      data.verification_role_id !== undefined
        ? data.verification_role_id
        : current.verification_role_id,

    autorole_id:
      data.autorole_id !== undefined
        ? data.autorole_id
        : current.autorole_id
  };

  const result = await pool.query(
    `UPDATE security_config
     SET enabled = $1,
         verification_enabled = $2,
         verification_role_id = $3,
         autorole_id = $4,
         updated_at = CURRENT_TIMESTAMP
     WHERE guild_id = $5
     RETURNING *`,
    [
      updated.enabled,
      updated.verification_enabled,
      updated.verification_role_id,
      updated.autorole_id,
      guildId
    ]
  );

  securityCache.set(guildId, result.rows[0]);

  return result.rows[0];
}


// ============================================================
// SECURITY COMMAND
// ============================================================

async function handleSecurityCommand(interaction) {
  if (!interaction.memberPermissions?.has("Administrator")) {
    return interaction.reply({
      content: "❌ You need **Administrator** permission to use this command.",
      ephemeral: true
    });
  }

  const enabled = interaction.options.getBoolean("enabled");

  const config = await updateSecurityConfig(
    interaction.guild.id,
    { enabled }
  );

  return interaction.reply({
    content:
      `🛡️ **Security System ${config.enabled ? "Enabled" : "Disabled"}**\n\n` +
      `Server security protection is now **${config.enabled ? "ON" : "OFF"}**.`,
    ephemeral: true
  });
}


// ============================================================
// VERIFICATION COMMAND
// ============================================================

async function handleVerificationCommand(interaction) {
  if (!interaction.memberPermissions?.has("Administrator")) {
    return interaction.reply({
      content: "❌ You need **Administrator** permission to use this command.",
      ephemeral: true
    });
  }

  const enabled = interaction.options.getBoolean("enabled");

  const config = await updateSecurityConfig(
    interaction.guild.id,
    { verification_enabled: enabled }
  );

  return interaction.reply({
    content:
      `✅ **Verification System ${enabled ? "Enabled" : "Disabled"}**\n\n` +
      `New members will ${enabled ? "require verification." : "not require verification."}`,
    ephemeral: true
  });
}


// ============================================================
// AUTOROLE COMMAND
// ============================================================

async function handleAutoroleCommand(interaction) {
  if (!interaction.memberPermissions?.has("ManageGuild")) {
    return interaction.reply({
      content: "❌ You need **Manage Server** permission.",
      ephemeral: true
    });
  }

  const role = interaction.options.getRole("role");

  if (!role) {
    return interaction.reply({
      content: "❌ Invalid role.",
      ephemeral: true
    });
  }

  if (role.managed) {
    return interaction.reply({
      content: "❌ Managed/integration roles cannot be used as autoroles.",
      ephemeral: true
    });
  }

  const botMember = interaction.guild.members.me;

  if (!botMember) {
    return interaction.reply({
      content: "❌ I could not find my bot member.",
      ephemeral: true
    });
  }

  if (role.position >= botMember.roles.highest.position) {
    return interaction.reply({
      content:
        "❌ I cannot assign this role because it is higher than or equal to my highest role.",
      ephemeral: true
    });
  }

  await updateSecurityConfig(
    interaction.guild.id,
    { autorole_id: role.id }
  );

  autoRoleCache.set(interaction.guild.id, role.id);

  return interaction.reply({
    content:
      `✅ **Auto Role Configured**\n\n` +
      `New members will receive ${role}.`,
    ephemeral: true
  });
}


// ============================================================
// MEMBER JOIN SECURITY
// ============================================================

client.on("guildMemberAdd", async (member) => {
  try {
    if (member.user.bot) return;

    const config = await getSecurityConfig(member.guild.id);

    // --------------------------------------------------------
    // AUTO ROLE
    // --------------------------------------------------------

    if (config.autorole_id) {
      const role = member.guild.roles.cache.get(config.autorole_id);

      if (role) {
        const botMember = member.guild.members.me;

        if (
          botMember &&
          !role.managed &&
          role.position < botMember.roles.highest.position
        ) {
          await member.roles.add(
            role,
            "Automatic member role"
          ).catch(() => {});
        }
      }
    }

    // --------------------------------------------------------
    // VERIFICATION
    // --------------------------------------------------------

    if (
      config.verification_enabled &&
      config.verification_role_id
    ) {
      const verificationRole =
        member.guild.roles.cache.get(
          config.verification_role_id
        );

      if (verificationRole) {
        await member.roles.add(
          verificationRole,
          "Verification system"
        ).catch(() => {});
      }
    }

    // --------------------------------------------------------
    // SECURITY ACCOUNT CHECK
    // --------------------------------------------------------

    if (config.enabled) {
      const accountAge =
        Date.now() - member.user.createdTimestamp;

      const oneDay =
        24 * 60 * 60 * 1000;

      // Very new account detection
      if (accountAge < oneDay) {
        console.log(
          `⚠️ New account joined: ${member.user.tag} (${member.id})`
        );
      }
    }

  } catch (error) {
    console.error(
      "❌ Guild member security error:",
      error.message
    );
  }
});


// ============================================================
// SECURITY STATUS HELPER
// ============================================================

async function securityStatus(guildId) {
  const config = await getSecurityConfig(guildId);

  return {
    security: Boolean(config.enabled),
    verification: Boolean(config.verification_enabled),
    autorole: config.autorole_id || null
  };
}


// ============================================================
// COMMAND ROUTER — PART 9
// ============================================================

// IMPORTANT:
// Add these cases INSIDE your existing interactionCreate
// command switch/router.
// Do NOT create another client.on("interactionCreate")
// if Part 4/5 already has one.

async function handlePart9Commands(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  switch (interaction.commandName) {

    case "security":
      await handleSecurityCommand(interaction);
      return true;

    case "verification":
      await handleVerificationCommand(interaction);
      return true;

    case "autorole":
      await handleAutoroleCommand(interaction);
      return true;

    default:
      return false;
  }
}


// ============================================================
// INITIALIZE PART 9
// ============================================================

ensureSecurityTable()
  .then(() => {
    console.log("✅ Part 9 Security system initialized.");
  })
  .catch(error => {
    console.error(
      "❌ Part 9 initialization failed:",
      error.message
    );
  });

// ============================================================
// PART 10 — LOGGING + AUDIT SYSTEM
// ============================================================

async function ensureLoggingTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS logging_config (
        guild_id VARCHAR(30) PRIMARY KEY,
        log_channel_id VARCHAR(30),
        mod_log_channel_id VARCHAR(30),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("✅ Logging database initialized.");
  } catch (error) {
    console.error("❌ Logging database error:", error.message);
  }
}


// ============================================================
// GET LOG CONFIG
// ============================================================

async function getLoggingConfig(guildId) {
  const result = await pool.query(
    `SELECT * FROM logging_config WHERE guild_id = $1`,
    [guildId]
  );

  if (result.rows.length > 0) {
    return result.rows[0];
  }

  const created = await pool.query(
    `INSERT INTO logging_config (guild_id)
     VALUES ($1)
     RETURNING *`,
    [guildId]
  );

  return created.rows[0];
}


// ============================================================
// UPDATE LOG CHANNEL
// ============================================================

async function setLogChannel(guildId, channelId) {
  await pool.query(
    `INSERT INTO logging_config (guild_id, log_channel_id)
     VALUES ($1, $2)
     ON CONFLICT (guild_id)
     DO UPDATE SET
       log_channel_id = EXCLUDED.log_channel_id,
       updated_at = CURRENT_TIMESTAMP`,
    [guildId, channelId]
  );
}


// ============================================================
// UPDATE MOD LOG CHANNEL
// ============================================================

async function setModLogChannel(guildId, channelId) {
  await pool.query(
    `INSERT INTO logging_config (guild_id, mod_log_channel_id)
     VALUES ($1, $2)
     ON CONFLICT (guild_id)
     DO UPDATE SET
       mod_log_channel_id = EXCLUDED.mod_log_channel_id,
       updated_at = CURRENT_TIMESTAMP`,
    [guildId, channelId]
  );
}


// ============================================================
// SEND LOG
// ============================================================

async function sendLog(guild, embed, moderation = false) {
  try {
    const config = await getLoggingConfig(guild.id);

    const channelId = moderation
      ? config.mod_log_channel_id
      : config.log_channel_id;

    if (!channelId) return;

    const channel = guild.channels.cache.get(channelId);

    if (!channel || !channel.isTextBased()) return;

    await channel.send({
      embeds: [embed]
    }).catch(() => {});

  } catch (error) {
    console.error("❌ Send log error:", error.message);
  }
}


// ============================================================
// SETLOGS
// ============================================================

async function handleSetLogs(interaction) {
  if (!interaction.memberPermissions?.has("ManageGuild")) {
    return interaction.reply({
      content: "❌ You need **Manage Server** permission.",
      ephemeral: true
    });
  }

  const channel = interaction.options.getChannel("channel");

  if (!channel || !channel.isTextBased()) {
    return interaction.reply({
      content: "❌ Please select a text channel.",
      ephemeral: true
    });
  }

  await setLogChannel(
    interaction.guild.id,
    channel.id
  );

  await interaction.reply({
    content: `✅ General logs will now be sent to ${channel}.`,
    ephemeral: true
  });
}


// ============================================================
// SETMODLOGS
// ============================================================

async function handleSetModLogs(interaction) {
  if (!interaction.memberPermissions?.has("ManageGuild")) {
    return interaction.reply({
      content: "❌ You need **Manage Server** permission.",
      ephemeral: true
    });
  }

  const channel = interaction.options.getChannel("channel");

  if (!channel || !channel.isTextBased()) {
    return interaction.reply({
      content: "❌ Please select a text channel.",
      ephemeral: true
    });
  }

  await setModLogChannel(
    interaction.guild.id,
    channel.id
  );

  await interaction.reply({
    content: `✅ Moderation logs will now be sent to ${channel}.`,
    ephemeral: true
  });
}


// ============================================================
// LOG CONFIGURATION
// ============================================================

async function handleLogs(interaction) {
  if (!interaction.memberPermissions?.has("ManageGuild")) {
    return interaction.reply({
      content: "❌ You need **Manage Server** permission.",
      ephemeral: true
    });
  }

  const config = await getLoggingConfig(
    interaction.guild.id
  );

  const general =
    config.log_channel_id
      ? `<#${config.log_channel_id}>`
      : "Not configured";

  const moderation =
    config.mod_log_channel_id
      ? `<#${config.mod_log_channel_id}>`
      : "Not configured";

  const embed = new EmbedBuilder()
    .setTitle("📋 Logging Configuration")
    .addFields(
      {
        name: "General Logs",
        value: general,
        inline: true
      },
      {
        name: "Moderation Logs",
        value: moderation,
        inline: true
      }
    )
    .setTimestamp();

  return interaction.reply({
    embeds: [embed],
    ephemeral: true
  });
}


// ============================================================
// MESSAGE DELETE LOG
// ============================================================

client.on("messageDelete", async (message) => {
  try {
    if (!message.guild) return;

    const embed = new EmbedBuilder()
      .setTitle("🗑️ Message Deleted")
      .addFields(
        {
          name: "User",
          value: message.author
            ? `${message.author} (${message.author.id})`
            : "Unknown"
        },
        {
          name: "Channel",
          value: `${message.channel}`
        },
        {
          name: "Content",
          value: message.content
            ? message.content.slice(0, 1000)
            : "No text content"
        }
      )
      .setTimestamp();

    await sendLog(message.guild, embed);

  } catch (error) {
    console.error("❌ Message delete log error:", error.message);
  }
});


// ============================================================
// MESSAGE EDIT LOG
// ============================================================

client.on("messageUpdate", async (oldMessage, newMessage) => {
  try {
    if (!oldMessage.guild) return;
    if (oldMessage.author?.bot) return;

    if (oldMessage.content === newMessage.content) return;

    const embed = new EmbedBuilder()
      .setTitle("✏️ Message Edited")
      .addFields(
        {
          name: "User",
          value: oldMessage.author
            ? `${oldMessage.author}`
            : "Unknown"
        },
        {
          name: "Channel",
          value: `${oldMessage.channel}`
        },
        {
          name: "Before",
          value: oldMessage.content
            ? oldMessage.content.slice(0, 1000)
            : "Empty"
        },
        {
          name: "After",
          value: newMessage.content
            ? newMessage.content.slice(0, 1000)
            : "Empty"
        }
      )
      .setTimestamp();

    await sendLog(oldMessage.guild, embed);

  } catch (error) {
    console.error("❌ Message edit log error:", error.message);
  }
});


// ============================================================
// MEMBER JOIN LOG
// ============================================================

client.on("guildMemberAdd", async (member) => {
  try {
    const embed = new EmbedBuilder()
      .setTitle("📥 Member Joined")
      .setDescription(
        `${member.user} joined the server.`
      )
      .addFields({
        name: "User ID",
        value: member.id
      })
      .setTimestamp();

    await sendLog(member.guild, embed);

  } catch (error) {
    console.error("❌ Join log error:", error.message);
  }
});


// ============================================================
// MEMBER LEAVE LOG
// ============================================================

client.on("guildMemberRemove", async (member) => {
  try {
    const embed = new EmbedBuilder()
      .setTitle("📤 Member Left")
      .setDescription(
        `${member.user.tag} left the server.`
      )
      .addFields({
        name: "User ID",
        value: member.id
      })
      .setTimestamp();

    await sendLog(member.guild, embed);

  } catch (error) {
    console.error("❌ Leave log error:", error.message);
  }
});


// ============================================================
// PART 10 COMMAND ROUTER
// ============================================================

async function handlePart10Commands(interaction) {
  if (!interaction.isChatInputCommand()) return false;

  switch (interaction.commandName) {

    case "setlogs":
      await handleSetLogs(interaction);
      return true;

    case "setmodlogs":
      await handleSetModLogs(interaction);
      return true;

    case "logs":
      await handleLogs(interaction);
      return true;

    default:
      return false;
  }
}


// ============================================================
// INITIALIZE PART 10
// ============================================================

ensureLoggingTable()
  .then(() => {
    console.log("✅ Part 10 Logging system initialized.");
  })
  .catch(error => {
    console.error(
      "❌ Part 10 initialization failed:",
      error.message
    );
  });

// ============================================================
// PART 11 — ADMIN ACTIVITY + INVITE TRACKING
// ============================================================

async function ensureActivityTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS member_activity (
        guild_id VARCHAR(30) NOT NULL,
        user_id VARCHAR(30) NOT NULL,
        messages INTEGER DEFAULT 0,
        commands INTEGER DEFAULT 0,
        voice_minutes INTEGER DEFAULT 0,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (guild_id, user_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS invite_stats (
        guild_id VARCHAR(30) NOT NULL,
        user_id VARCHAR(30) NOT NULL,
        invites INTEGER DEFAULT 0,
        fake_invites INTEGER DEFAULT 0,
        left_members INTEGER DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      )
    `);

    console.log("✅ Part 11 database initialized.");
  } catch (error) {
    console.error("❌ Part 11 database error:", error.message);
  }
}


// ============================================================
// ACTIVITY TRACKING
// ============================================================

async function recordActivity(guildId, userId, type) {
  try {
    await pool.query(
      `
      INSERT INTO member_activity
        (guild_id, user_id, messages, commands, voice_minutes)
      VALUES
        ($1, $2, $3, $4, $5)
      ON CONFLICT (guild_id, user_id)
      DO UPDATE SET
        messages = member_activity.messages + EXCLUDED.messages,
        commands = member_activity.commands + EXCLUDED.commands,
        voice_minutes =
          member_activity.voice_minutes + EXCLUDED.voice_minutes,
        last_activity = CURRENT_TIMESTAMP
      `,
      [
        guildId,
        userId,
        type === "message" ? 1 : 0,
        type === "command" ? 1 : 0,
        type === "voice" ? 1 : 0
      ]
    );
  } catch (error) {
    console.error("❌ Activity tracking error:", error.message);
  }
}


// ============================================================
// MESSAGE ACTIVITY
// ============================================================

client.on("messageCreate", async (message) => {
  try {
    if (!message.guild || message.author.bot) return;

    await recordActivity(
      message.guild.id,
      message.author.id,
      "message"
    );
  } catch (error) {
    console.error("❌ Message activity error:", error.message);
  }
});


// ============================================================
// COMMAND ACTIVITY
// ============================================================

client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.guild) return;
    if (!interaction.isChatInputCommand()) return;
    if (interaction.user.bot) return;

    await recordActivity(
      interaction.guild.id,
      interaction.user.id,
      "command"
    );
  } catch (error) {
    console.error("❌ Command activity error:", error.message);
  }
});


// ============================================================
// VOICE ACTIVITY
// ============================================================

const voiceJoinTimes = new Map();

client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const userId = newState.id;
    const guildId = newState.guild.id;

    // Joined voice
    if (!oldState.channelId && newState.channelId) {
      voiceJoinTimes.set(
        `${guildId}:${userId}`,
        Date.now()
      );
      return;
    }

    // Left voice
    if (oldState.channelId && !newState.channelId) {
      const key = `${guildId}:${userId}`;
      const joinedAt = voiceJoinTimes.get(key);

      if (!joinedAt) return;

      const minutes = Math.max(
        1,
        Math.floor(
          (Date.now() - joinedAt) / 60000
        )
      );

      voiceJoinTimes.delete(key);

      for (let i = 0; i < minutes; i++) {
        await recordActivity(
          guildId,
          userId,
          "voice"
        );
      }
    }
  } catch (error) {
    console.error("❌ Voice activity error:", error.message);
  }
});


// ============================================================
// /ACTIVITY
// ============================================================

async function handleActivity(interaction) {
  const user =
    interaction.options.getUser("user") ||
    interaction.user;

  const result = await pool.query(
    `
    SELECT *
    FROM member_activity
    WHERE guild_id = $1
      AND user_id = $2
    `,
    [
      interaction.guild.id,
      user.id
    ]
  );

  const data = result.rows[0];

  if (!data) {
    return interaction.reply({
      content: `📊 No activity recorded for **${user.tag}** yet.`,
      ephemeral: true
    });
  }

  const embed = new EmbedBuilder()
    .setTitle("📊 Member Activity")
    .setDescription(`${user}`)
    .addFields(
      {
        name: "💬 Messages",
        value: String(data.messages),
        inline: true
      },
      {
        name: "⚙️ Commands",
        value: String(data.commands),
        inline: true
      },
      {
        name: "🎙️ Voice Minutes",
        value: String(data.voice_minutes),
        inline: true
      },
      {
        name: "🕐 Last Activity",
        value: `<t:${Math.floor(
          new Date(data.last_activity).getTime() / 1000
        )}:R>`,
        inline: false
      }
    )
    .setTimestamp();

  return interaction.reply({
    embeds: [embed],
    ephemeral: true
  });
}


// ============================================================
// /ADMINACTIVITY
// ============================================================

async function handleAdminActivity(interaction) {
  if (!interaction.memberPermissions?.has("ManageGuild")) {
    return interaction.reply({
      content: "❌ You need **Manage Server** permission.",
      ephemeral: true
    });
  }

  const result = await pool.query(`
    SELECT
      user_id,
      messages,
      commands,
      voice_minutes,
      last_activity
    FROM member_activity
    WHERE guild_id = $1
    ORDER BY
      messages DESC,
      commands DESC,
      voice_minutes DESC
    LIMIT 20
  `, [interaction.guild.id]);

  if (!result.rows.length) {
    return interaction.reply({
      content: "📊 No activity data available yet.",
      ephemeral: true
    });
  }

  const lines = [];

  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows[i];

    const member =
      interaction.guild.members.cache.get(row.user_id);

    if (!member) continue;

    lines.push(
      `**${i + 1}. ${member.user.tag}**\n` +
      `💬 ${row.messages} messages • ` +
      `⚙️ ${row.commands} commands • ` +
      `🎙️ ${row.voice_minutes} min`
    );
  }

  const embed = new EmbedBuilder()
    .setTitle("👑 Admin Activity")
    .setDescription(
      lines.length
        ? lines.join("\n\n")
        : "No current members found."
    )
    .setTimestamp();

  return interaction.reply({
    embeds: [embed],
    ephemeral: true
  });
}


// ============================================================
// /LEADERBOARD
// ============================================================

async function handleLeaderboard(interaction) {
  const result = await pool.query(`
    SELECT
      user_id,
      messages,
      commands,
      voice_minutes
    FROM member_activity
    WHERE guild_id = $1
    ORDER BY
      (messages + commands + voice_minutes) DESC
    LIMIT 10
  `, [interaction.guild.id]);

  if (!result.rows.length) {
    return interaction.reply({
      content: "🏆 No activity data available yet.",
      ephemeral: true
    });
  }

  const lines = [];

  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows[i];

    const member =
      interaction.guild.members.cache.get(row.user_id);

    if (!member) continue;

    const score =
      Number(row.messages) +
      Number(row.commands) +
      Number(row.voice_minutes);

    lines.push(
      `**${i + 1}. ${member.user.tag}** — ${score} points`
    );
  }

  const embed = new EmbedBuilder()
    .setTitle("🏆 Activity Leaderboard")
    .setDescription(
      lines.length
        ? lines.join("\n")
        : "No current members found."
    )
    .setTimestamp();

  return interaction.reply({
    embeds: [embed]
  });
}


// ============================================================
// INVITE CACHE
// ============================================================

const inviteCache = new Map();

async function cacheGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();

    const data = new Map();

    invites.forEach(invite => {
      data.set(invite.code, invite.uses || 0);
    });

    inviteCache.set(guild.id, data);
  } catch (error) {
    console.error(
      `❌ Could not cache invites for ${guild.name}:`,
      error.message
    );
  }
}


// ============================================================
// READY — CACHE INVITES
// ============================================================

client.once("ready", async () => {
  try {
    for (const guild of client.guilds.cache.values()) {
      await cacheGuildInvites(guild);
    }

    console.log("✅ Invite tracking initialized.");
  } catch (error) {
    console.error("❌ Invite cache error:", error.message);
  }
});


// ============================================================
// MEMBER JOIN — DETECT INVITER
// ============================================================

client.on("guildMemberAdd", async (member) => {
  try {
    const oldInvites =
      inviteCache.get(member.guild.id) ||
      new Map();

    const newInvites =
      await member.guild.invites.fetch();

    let usedInvite = null;

    newInvites.forEach(invite => {
      const oldUses =
        oldInvites.get(invite.code) || 0;

      if ((invite.uses || 0) > oldUses) {
        usedInvite = invite;
      }
    });

    const updatedCache = new Map();

    newInvites.forEach(invite => {
      updatedCache.set(
        invite.code,
        invite.uses || 0
      );
    });

    inviteCache.set(
      member.guild.id,
      updatedCache
    );

    if (!usedInvite?.inviter) return;

    const inviterId = usedInvite.inviter.id;

    await pool.query(
      `
      INSERT INTO invite_stats
        (guild_id, user_id, invites)
      VALUES
        ($1, $2, 1)
      ON CONFLICT (guild_id, user_id)
      DO UPDATE SET
        invites = invite_stats.invites + 1
      `,
      [
        member.guild.id,
        inviterId
      ]
    );

  } catch (error) {
    console.error("❌ Invite tracking error:", error.message);
  }
});


// ============================================================
// /INVITES
// ============================================================

async function handleInvites(interaction) {
  const user =
    interaction.options.getUser("user") ||
    interaction.user;

  const result = await pool.query(
    `
    SELECT *
    FROM invite_stats
    WHERE guild_id = $1
      AND user_id = $2
    `,
    [
      interaction.guild.id,
      user.id
    ]
  );

  const data = result.rows[0];

  const invites = data?.invites || 0;
  const fake = data?.fake_invites || 0;
  const left = data?.left_members || 0;

  const embed = new EmbedBuilder()
    .setTitle("📨 Invite Statistics")
    .setDescription(`${user}`)
    .addFields(
      {
        name: "✅ Invites",
        value: String(invites),
        inline: true
      },
      {
        name: "⚠️ Fake",
        value: String(fake),
        inline: true
      },
      {
        name: "📤 Left",
        value: String(left),
        inline: true
      }
    )
    .setTimestamp();

  return interaction.reply({
    embeds: [embed]
  });
}


// ============================================================
// /INVITELEADERBOARD
// ============================================================

async function handleInviteLeaderboard(interaction) {
  const result = await pool.query(
    `
    SELECT user_id, invites
    FROM invite_stats
    WHERE guild_id = $1
    ORDER BY invites DESC
    LIMIT 10
    `,
    [interaction.guild.id]
  );

  if (!result.rows.length) {
    return interaction.reply({
      content: "📨 No invite data available yet.",
      ephemeral: true
    });
  }

  const lines = [];

  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows[i];

    const member =
      interaction.guild.members.cache.get(row.user_id);

    if (!member) continue;

    lines.push(
      `**${i + 1}. ${member.user.tag}** — ` +
      `**${row.invites}** invites`
    );
  }

  const embed = new EmbedBuilder()
    .setTitle("🏆 Invite Leaderboard")
    .setDescription(
      lines.length
        ? lines.join("\n")
        : "No current members found."
    )
    .setTimestamp();

  return interaction.reply({
    embeds: [embed]
  });
}


// ============================================================
// PART 11 COMMAND ROUTER
// ============================================================

// Add these cases to your EXISTING command router.
// Do NOT create another router.

async function handlePart11Commands(interaction) {
  switch (interaction.commandName) {

    case "activity":
      await handleActivity(interaction);
      return true;

    case "adminactivity":
      await handleAdminActivity(interaction);
      return true;

    case "leaderboard":
      await handleLeaderboard(interaction);
      return true;

    case "invites":
      await handleInvites(interaction);
      return true;

    case "inviteleaderboard":
      await handleInviteLeaderboard(interaction);
      return true;

    default:
      return false;
  }
}


// ============================================================
// INITIALIZE PART 11
// ============================================================

ensureActivityTables()
  .then(() => {
    console.log("✅ Part 11 Activity system initialized.");
  })
  .catch(error => {
    console.error(
      "❌ Part 11 initialization failed:",
      error.message
    );
  });
