"use strict";

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder
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
  console.error("❌ TOKEN, CLIENT_ID or DATABASE_URL is missing.");
  process.exit(1);
}

/* =========================================================
   DISCORD CLIENT
========================================================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User
  ]
});

/* =========================================================
   DATABASE
========================================================= */

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});

async function db(query, params = []) {
  return pool.query(query, params);
}

async function initDatabase() {
  await db(`
    CREATE TABLE IF NOT EXISTS tickets (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(30) NOT NULL,
      guild_id VARCHAR(30) NOT NULL,
      channel_id VARCHAR(30),
      status VARCHAR(20) DEFAULT 'open',
      claimed_by VARCHAR(30),
      transferred_to VARCHAR(30),
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
      user_id VARCHAR(30),
      staff_id VARCHAR(30),
      direction VARCHAR(20),
      content TEXT,
      attachment_urls TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS ticket_notes (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
      staff_id VARCHAR(30),
      note TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS warnings (
      id SERIAL PRIMARY KEY,
      guild_id VARCHAR(30),
      user_id VARCHAR(30),
      moderator_id VARCHAR(30),
      reason TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS modlogs (
      id SERIAL PRIMARY KEY,
      guild_id VARCHAR(30),
      user_id VARCHAR(30),
      moderator_id VARCHAR(30),
      action VARCHAR(50),
      reason TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS blocked_users (
      guild_id VARCHAR(30),
      user_id VARCHAR(30),
      blocked_by VARCHAR(30),
      reason TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY(guild_id, user_id)
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS settings (
      guild_id VARCHAR(30) PRIMARY KEY,
      automod BOOLEAN DEFAULT TRUE,
      spam BOOLEAN DEFAULT TRUE,
      links BOOLEAN DEFAULT TRUE,
      invites BOOLEAN DEFAULT TRUE,
      mentions BOOLEAN DEFAULT TRUE,
      badwords BOOLEAN DEFAULT TRUE,
      auto_timeout BOOLEAN DEFAULT TRUE,
      inactivity_hours INTEGER DEFAULT 48,
      ticket_category VARCHAR(30),
      ticket_log_channel VARCHAR(30)
    )
  `);

  await db(`
    INSERT INTO settings (guild_id)
    VALUES ($1)
    ON CONFLICT (guild_id) DO NOTHING
  `, [SERVER_ID]);

  console.log("✅ PostgreSQL database ready.");
}

/* =========================================================
   HELPERS
========================================================= */

function isStaff(member) {
  return member?.roles?.cache?.has(SUPPORT_ADMIN_ROLE_ID) ||
    member?.permissions?.has(PermissionsBitField.Flags.Administrator);
}

function staffOnly(interaction) {
  if (!interaction.member || !isStaff(interaction.member)) {
    return false;
  }
  return true;
}

async function replySafe(interaction, data) {
  try {
    if (interaction.replied || interaction.deferred) {
      return interaction.followUp(data);
    }
    return interaction.reply(data);
  } catch (err) {
    console.error("Reply error:", err.message);
  }
}

async function logAction(guild, title, description, fields = []) {
  try {
    const channel = guild.channels.cache.get(SUPPORT_LOG_CHANNEL_ID);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description || "No description")
      .setTimestamp();

    if (fields.length) embed.addFields(fields);

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error("Log error:", err.message);
  }
}

function ticketButtons(ticketId, held = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_claim_${ticketId}`)
      .setLabel("Claim")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(`ticket_${held ? "resume" : "hold"}_${ticketId}`)
      .setLabel(held ? "Resume" : "Hold")
      .setEmoji(held ? "▶️" : "⏸️")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`ticket_close_${ticketId}`)
      .setLabel("Close")
      .setEmoji("🔴")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId(`ticket_info_${ticketId}`)
      .setLabel("Player Info")
      .setEmoji("👤")
      .setStyle(ButtonStyle.Success)
  );
}

async function getTicketById(id) {
  const result = await db(
    "SELECT * FROM tickets WHERE id=$1 LIMIT 1",
    [id]
  );
  return result.rows[0];
}

async function getOpenTicket(userId) {
  const result = await db(
    `SELECT * FROM tickets
     WHERE user_id=$1 AND guild_id=$2
     AND status IN ('open','hold')
     ORDER BY id DESC LIMIT 1`,
    [userId, SERVER_ID]
  );
  return result.rows[0];
}

async function createTicket(user, guild) {
  const existing = await getOpenTicket(user.id);

  if (existing) {
    return {
      existing: true,
      ticket: existing
    };
  }

  const category = guild.channels.cache.find(
    c =>
      c.type === ChannelType.GuildCategory &&
      c.name.toLowerCase() === "support tickets"
  );

  let ticketCategory = category;

  if (!ticketCategory) {
    ticketCategory = await guild.channels.create({
      name: "Support Tickets",
      type: ChannelType.GuildCategory
    });
  }

  const ticketResult = await db(
    `INSERT INTO tickets (user_id, guild_id, status)
     VALUES ($1,$2,'open')
     RETURNING *`,
    [user.id, guild.id]
  );

  const ticket = ticketResult.rows[0];

  const channel = await guild.channels.create({
    name: `ticket-${ticket.id}`,
    type: ChannelType.GuildText,
    parent: ticketCategory.id,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel]
      },
      {
        id: user.id,
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

  await db(
    "UPDATE tickets SET channel_id=$1 WHERE id=$2",
    [channel.id, ticket.id]
  );

  const embed = new EmbedBuilder()
    .setTitle("🎫 Grand Mafia Support")
    .setDescription(
      `Welcome <@${user.id}>.\n\n` +
      `A support staff member will assist you shortly.\n\n` +
      `**Ticket:** #${ticket.id}\n` +
      `**Status:** 🟢 Open`
    )
    .setTimestamp();

  await channel.send({
    content: `<@${user.id}> <@&${SUPPORT_ADMIN_ROLE_ID}>`,
    embeds: [embed],
    components: [ticketButtons(ticket.id)]
  });

  await logAction(
    guild,
    "🎫 Ticket Created",
    `Ticket #${ticket.id} created.`,
    [
      { name: "Player", value: `<@${user.id}>`, inline: true },
      { name: "Channel", value: `${channel}`, inline: true }
    ]
  );

  return {
    existing: false,
    ticket: {
      ...ticket,
      channel_id: channel.id
    }
  };
}

/* =========================================================
   COMMANDS
========================================================= */

const commands = [

  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Create a support ticket"),

  new SlashCommandBuilder()
    .setName("ticket-close")
    .setDescription("Close the current ticket"),

  new SlashCommandBuilder()
    .setName("ticket-reopen")
    .setDescription("Reopen a ticket")
    .addIntegerOption(o =>
      o.setName("id")
        .setDescription("Ticket ID")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ticket-claim")
    .setDescription("Claim a ticket"),

  new SlashCommandBuilder()
    .setName("ticket-hold")
    .setDescription("Put ticket on hold"),

  new SlashCommandBuilder()
    .setName("ticket-resume")
    .setDescription("Resume ticket"),

  new SlashCommandBuilder()
    .setName("ticket-note")
    .setDescription("Add an internal note")
    .addStringOption(o =>
      o.setName("note")
        .setDescription("Internal note")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ticket-history")
    .setDescription("Show ticket history"),

  new SlashCommandBuilder()
    .setName("ticket-info")
    .setDescription("Show ticket information"),

  new SlashCommandBuilder()
    .setName("ticket-block")
    .setDescription("Block a player from tickets")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Player")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
    ),

  new SlashCommandBuilder()
    .setName("ticket-unblock")
    .setDescription("Unblock a player")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Player")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("reply")
    .setDescription("Reply to a ticket player")
    .addStringOption(o =>
      o.setName("message")
        .setDescription("Message")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member")
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
    .setName("warnings")
    .setDescription("View warnings")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Clear messages")
    .addIntegerOption(o =>
      o.setName("amount")
        .setDescription("1-100")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a member")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("minutes")
        .setDescription("Minutes")
        .setMinValue(1)
        .setMaxValue(40320)
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
    ),

  new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Remove timeout")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
    ),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a user")
    .addStringOption(o =>
      o.setName("userid")
        .setDescription("User ID")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("modlogs")
    .setDescription("View moderation logs")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("automod")
    .setDescription("Show or configure AutoMod")
    .addStringOption(o =>
      o.setName("setting")
        .setDescription("Setting")
        .addChoices(
          { name: "on", value: "on" },
          { name: "off", value: "off" }
        )
    ),

  new SlashCommandBuilder()
    .setName("security")
    .setDescription("Show security status"),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Send an announcement")
    .addStringOption(o =>
      o.setName("message")
        .setDescription("Announcement")
        .setRequired(true)
    )
    .addAttachmentOption(o =>
      o.setName("image")
        .setDescription("Optional image")
    ),

  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Send a message")
    .addStringOption(o =>
      o.setName("message")
        .setDescription("Message")
        .setRequired(true)
    )
    .addAttachmentOption(o =>
      o.setName("image")
        .setDescription("Optional image")
    ),

  new SlashCommandBuilder()
    .setName("admin-stats")
    .setDescription("Show support statistics"),

  new SlashCommandBuilder()
    .setName("player")
    .setDescription("Show player information")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Player")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Set channel slowmode")
    .addIntegerOption(o =>
      o.setName("seconds")
        .setDescription("Seconds")
        .setMinValue(0)
        .setMaxValue(21600)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Lock current channel"),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Unlock current channel")

].map(c => c.toJSON());

/* =========================================================
   REGISTER COMMANDS
========================================================= */

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, SERVER_ID),
    { body: commands }
  );

  console.log("✅ Slash commands registered successfully.");
}

/* =========================================================
   READY
========================================================= */

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🏠 Server ID: ${SERVER_ID}`);
  console.log(`🛡️ Support Role: ${SUPPORT_ADMIN_ROLE_ID}`);
  console.log(`📋 Log Channel: ${SUPPORT_LOG_CHANNEL_ID}`);

  try {
    await initDatabase();
    await registerCommands();
  } catch (err) {
    console.error("Startup error:", err);
  }

  client.user.setActivity("Grand Mafia Support", {
    type: 3
  });
});

/* =========================================================
   INTERACTIONS
========================================================= */

client.on("interactionCreate", async interaction => {

  try {

    /* ---------------- SLASH COMMANDS ---------------- */

    if (interaction.isChatInputCommand()) {

      const name = interaction.commandName;

      /* TICKET */

      if (name === "ticket") {
        await interaction.deferReply({ ephemeral: true });

        const blocked = await db(
          "SELECT 1 FROM blocked_users WHERE guild_id=$1 AND user_id=$2",
          [SERVER_ID, interaction.user.id]
        );

        if (blocked.rowCount) {
          return interaction.editReply("🚫 You are blocked from opening support tickets.");
        }

        const result = await createTicket(interaction.user, interaction.guild);

        if (result.existing) {
          return interaction.editReply(
            `🎫 You already have an open ticket: <#${result.ticket.channel_id}>`
          );
        }

        return interaction.editReply(
          `✅ Your ticket has been created: <#${result.ticket.channel_id}>`
        );
      }

      /* STAFF CHECK */

      const staffCommands = [
        "ticket-close",
        "ticket-reopen",
        "ticket-claim",
        "ticket-hold",
        "ticket-resume",
        "ticket-note",
        "ticket-history",
        "ticket-info",
        "ticket-block",
        "ticket-unblock",
        "reply",
        "warn",
        "warnings",
        "clear",
        "timeout",
        "untimeout",
        "kick",
        "ban",
        "unban",
        "modlogs",
        "automod",
        "security",
        "announce",
        "say",
        "admin-stats",
        "player",
        "slowmode",
        "lock",
        "unlock"
      ];

      if (staffCommands.includes(name) && !staffOnly(interaction)) {
        return replySafe(interaction, {
          content: "❌ You don't have permission to use this command.",
          ephemeral: true
        });
      }

      /* CLOSE */

      if (name === "ticket-close") {
        await interaction.deferReply({ ephemeral: true });

        const ticket = await db(
          `SELECT * FROM tickets WHERE channel_id=$1
           AND status IN ('open','hold') LIMIT 1`,
          [interaction.channel.id]
        );

        if (!ticket.rowCount) {
          return interaction.editReply("❌ This is not an active ticket.");
        }

        const t = ticket.rows[0];

        await db(
          `UPDATE tickets
           SET status='closed', closed_at=NOW(), updated_at=NOW()
           WHERE id=$1`,
          [t.id]
        );

        await interaction.channel.permissionOverwrites.edit(
          t.user_id,
          { SendMessages: false }
        );

        await interaction.channel.send(
          `🔴 Ticket #${t.id} has been closed by ${interaction.user}.`
        );

        await logAction(
          interaction.guild,
          "🔴 Ticket Closed",
          `Ticket #${t.id} closed.`,
          [
            { name: "Player", value: `<@${t.user_id}>` },
            { name: "Staff", value: `<@${interaction.user.id}>` }
          ]
        );

        return interaction.editReply("✅ Ticket closed.");
      }

      /* CLAIM */

      if (name === "ticket-claim") {
        await interaction.deferReply({ ephemeral: true });

        const ticket = await db(
          "SELECT * FROM tickets WHERE channel_id=$1 AND status='open'",
          [interaction.channel.id]
        );

        if (!ticket.rowCount) {
          return interaction.editReply("❌ No active ticket found.");
        }

        await db(
          "UPDATE tickets SET claimed_by=$1, updated_at=NOW() WHERE id=$2",
          [interaction.user.id, ticket.rows[0].id]
        );

        await interaction.channel.send(
          `🎫 ${interaction.user} has claimed this ticket.`
        );

        return interaction.editReply("✅ Ticket claimed.");
      }

      /* HOLD */

      if (name === "ticket-hold") {
        const result = await db(
          "SELECT * FROM tickets WHERE channel_id=$1 AND status='open'",
          [interaction.channel.id]
        );

        if (!result.rowCount) {
          return replySafe(interaction, {
            content: "❌ No active ticket.",
            ephemeral: true
          });
        }

        await db(
          "UPDATE tickets SET status='hold', held=true, updated_at=NOW() WHERE id=$1",
          [result.rows[0].id]
        );

        await interaction.channel.send(
          `⏸️ Ticket placed on hold by ${interaction.user}.`
        );

        return replySafe(interaction, {
          content: "✅ Ticket is now on hold.",
          ephemeral: true
        });
      }

      /* RESUME */

      if (name === "ticket-resume") {
        const result = await db(
          "SELECT * FROM tickets WHERE channel_id=$1 AND status='hold'",
          [interaction.channel.id]
        );

        if (!result.rowCount) {
          return replySafe(interaction, {
            content: "❌ No held ticket.",
            ephemeral: true
          });
        }

        await db(
          "UPDATE tickets SET status='open', held=false, updated_at=NOW() WHERE id=$1",
          [result.rows[0].id]
        );

        await interaction.channel.send(
          `▶️ Ticket resumed by ${interaction.user}.`
        );

        return replySafe(interaction, {
          content: "✅ Ticket resumed.",
          ephemeral: true
        });
      }

      /* REOPEN */

      if (name === "ticket-reopen") {
        await interaction.deferReply({ ephemeral: true });

        const ticket = await getTicketById(
          interaction.options.getInteger("id")
        );

        if (!ticket) {
          return interaction.editReply("❌ Ticket not found.");
        }

        await db(
          `UPDATE tickets
           SET status='open', closed_at=NULL, updated_at=NOW()
           WHERE id=$1`,
          [ticket.id]
        );

        const channel = interaction.guild.channels.cache.get(
          ticket.channel_id
        );

        if (channel) {
          await channel.permissionOverwrites.edit(
            ticket.user_id,
            { SendMessages: true }
          );

          await channel.send(
            `🔓 Ticket #${ticket.id} reopened by ${interaction.user}.`
          );
        }

        return interaction.editReply("✅ Ticket reopened.");
      }

      /* NOTE */

      if (name === "ticket-note") {
        const result = await db(
          "SELECT * FROM tickets WHERE channel_id=$1 AND status!='closed'",
          [interaction.channel.id]
        );

        if (!result.rowCount) {
          return replySafe(interaction, {
            content: "❌ No ticket found.",
            ephemeral: true
          });
        }

        await db(
          `INSERT INTO ticket_notes (ticket_id, staff_id, note)
           VALUES ($1,$2,$3)`,
          [
            result.rows[0].id,
            interaction.user.id,
            interaction.options.getString("note")
          ]
        );

        return replySafe(interaction, {
          content: "📝 Internal note saved.",
          ephemeral: true
        });
      }

      /* HISTORY */

      if (name === "ticket-history") {
        const result = await db(
          "SELECT * FROM tickets WHERE channel_id=$1 ORDER BY id DESC LIMIT 1",
          [interaction.channel.id]
        );

        if (!result.rowCount) {
          return replySafe(interaction, {
            content: "❌ Ticket not found.",
            ephemeral: true
          });
        }

        const t = result.rows[0];

        const messages = await db(
          `SELECT * FROM ticket_messages
           WHERE ticket_id=$1
           ORDER BY created_at DESC LIMIT 10`,
          [t.id]
        );

        const embed = new EmbedBuilder()
          .setTitle(`📋 Ticket #${t.id} History`)
          .addFields(
            { name: "Player", value: `<@${t.user_id}>`, inline: true },
            { name: "Status", value: t.status, inline: true },
            {
              name: "Claimed",
              value: t.claimed_by ? `<@${t.claimed_by}>` : "Nobody",
              inline: true
            }
          );

        if (messages.rowCount) {
          embed.addFields({
            name: "Recent Messages",
            value: messages.rows
              .reverse()
              .map(m =>
                `**${m.direction}**: ${(m.content || "[attachment]").slice(0, 200)}`
              )
              .join("\n")
              .slice(0, 1024)
          });
        }

        return replySafe(interaction, {
          embeds: [embed],
          ephemeral: true
        });
      }

      /* INFO */

      if (name === "ticket-info") {
        const result = await db(
          "SELECT * FROM tickets WHERE channel_id=$1 ORDER BY id DESC LIMIT 1",
          [interaction.channel.id]
        );

        if (!result.rowCount) {
          return replySafe(interaction, {
            content: "❌ This is not a ticket channel.",
            ephemeral: true
          });
        }

        const t = result.rows[0];

        const embed = new EmbedBuilder()
          .setTitle(`🎫 Ticket #${t.id}`)
          .addFields(
            { name: "Player", value: `<@${t.user_id}>`, inline: true },
            { name: "Status", value: t.status, inline: true },
            {
              name: "Claimed By",
              value: t.claimed_by ? `<@${t.claimed_by}>` : "Unclaimed",
              inline: true
            }
          )
          .setTimestamp();

        return replySafe(interaction, {
          embeds: [embed],
          ephemeral: true
        });
      }

      /* BLOCK */

      if (name === "ticket-block") {
        const user = interaction.options.getUser("user");
        const reason =
          interaction.options.getString("reason") || "No reason provided";

        await db(
          `INSERT INTO blocked_users
           (guild_id,user_id,blocked_by,reason)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (guild_id,user_id)
           DO UPDATE SET blocked_by=$3, reason=$4`,
          [SERVER_ID, user.id, interaction.user.id, reason]
        );

        await logAction(
          interaction.guild,
          "🚫 Ticket Block",
          `${user} was blocked from support.`,
          [{ name: "Reason", value: reason }]
        );

        return replySafe(interaction, {
          content: `🚫 ${user} has been blocked from support.`,
          ephemeral: true
        });
      }

      /* UNBLOCK */

      if (name === "ticket-unblock") {
        const user = interaction.options.getUser("user");

        await db(
          "DELETE FROM blocked_users WHERE guild_id=$1 AND user_id=$2",
          [SERVER_ID, user.id]
        );

        return replySafe(interaction, {
          content: `🔓 ${user} has been unblocked.`,
          ephemeral: true
        });
      }

      /* REPLY */

      if (name === "reply") {
        const ticket = await db(
          "SELECT * FROM tickets WHERE channel_id=$1 AND status!='closed'",
          [interaction.channel.id]
        );

        if (!ticket.rowCount) {
          return replySafe(interaction, {
            content: "❌ This is not an active ticket.",
            ephemeral: true
          });
        }

        const t = ticket.rows[0];
        const message = interaction.options.getString("message");

        const user = await client.users.fetch(t.user_id);

        await user.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("💬 Grand Mafia Support")
              .setDescription(message)
              .setFooter({
                text: `Ticket #${t.id}`
              })
              .setTimestamp()
          ]
        });

        await db(
          `INSERT INTO ticket_messages
           (ticket_id,staff_id,direction,content)
           VALUES ($1,$2,'STAFF_TO_PLAYER',$3)`,
          [t.id, interaction.user.id, message]
        );

        await interaction.channel.send(
          `💬 **Support reply sent:** ${message}`
        );

        return replySafe(interaction, {
          content: "✅ Reply sent to player.",
          ephemeral: true
        });
      }

      /* WARN */

      if (name === "warn") {
        const user = interaction.options.getUser("user");
        const reason = interaction.options.getString("reason");

        await db(
          `INSERT INTO warnings
           (guild_id,user_id,moderator_id,reason)
           VALUES ($1,$2,$3,$4)`,
          [SERVER_ID, user.id, interaction.user.id, reason]
        );

        await db(
          `INSERT INTO modlogs
           (guild_id,user_id,moderator_id,action,reason)
           VALUES ($1,$2,$3,'WARN',$4)`,
          [SERVER_ID, user.id, interaction.user.id, reason]
        );

        try {
          await user.send(`⚠️ You received a warning in Grand Mafia.\nReason: ${reason}`);
        } catch {}

        await logAction(
          interaction.guild,
          "⚠️ Warning",
          `${user} received a warning.`,
          [
            { name: "Moderator", value: `${interaction.user}` },
            { name: "Reason", value: reason }
          ]
        );

        return replySafe(interaction, {
          content: `⚠️ ${user} warned.`,
          ephemeral: true
        });
      }

      /* WARNINGS */

      if (name === "warnings") {
        const user = interaction.options.getUser("user");

        const result = await db(
          `SELECT * FROM warnings
           WHERE guild_id=$1 AND user_id=$2
           ORDER BY created_at DESC`,
          [SERVER_ID, user.id]
        );

        if (!result.rowCount) {
          return replySafe(interaction, {
            content: `✅ ${user} has no warnings.`,
            ephemeral: true
          });
        }

        const text = result.rows
          .slice(0, 15)
          .map((w, i) =>
            `**${i + 1}.** ${w.reason} — <@${w.moderator_id}>`
          )
          .join("\n");

        return replySafe(interaction, {
          embeds: [
            new EmbedBuilder()
              .setTitle(`⚠️ Warnings — ${user.tag}`)
              .setDescription(text)
          ],
          ephemeral: true
        });
      }

      /* CLEAR */

      if (name === "clear") {
        if (!interaction.channel?.isTextBased()) {
          return replySafe(interaction, {
            content: "❌ This command cannot be used here.",
            ephemeral: true
          });
        }

        const amount = interaction.options.getInteger("amount");

        const deleted = await interaction.channel.bulkDelete(
          amount,
          true
        );

        return replySafe(interaction, {
          content: `🧹 Deleted ${deleted.size} messages.`,
          ephemeral: true
        });
      }

      /* TIMEOUT */

      if (name === "timeout") {
        const user = interaction.options.getUser("user");
        const minutes = interaction.options.getInteger("minutes");
        const reason =
          interaction.options.getString("reason") || "No reason provided";

        const member =
          interaction.guild.members.cache.get(user.id) ||
          await interaction.guild.members.fetch(user.id).catch(() => null);

        if (!member) {
          return replySafe(interaction, {
            content: "❌ Member not found.",
            ephemeral: true
          });
        }

        await member.timeout(
          minutes * 60 * 1000,
          reason
        );

        await db(
          `INSERT INTO modlogs
           (guild_id,user_id,moderator_id,action,reason)
           VALUES ($1,$2,$3,'TIMEOUT',$4)`,
          [SERVER_ID, user.id, interaction.user.id, reason]
        );

        await logAction(
          interaction.guild,
          "⏰ Timeout",
          `${user} was timed out.`,
          [
            { name: "Duration", value: `${minutes} minutes` },
            { name: "Reason", value: reason }
          ]
        );

        return replySafe(interaction, {
          content: `⏰ ${user} timed out for ${minutes} minutes.`,
          ephemeral: true
        });
      }

      /* UNTIMEOUT */

      if (name === "untimeout") {
        const user = interaction.options.getUser("user");

        const member =
          interaction.guild.members.cache.get(user.id) ||
          await interaction.guild.members.fetch(user.id);

        await member.timeout(null, "Timeout removed by staff");

        return replySafe(interaction, {
          content: `▶️ Timeout removed from ${user}.`,
          ephemeral: true
        });
      }

      /* KICK */

      if (name === "kick") {
        const user = interaction.options.getUser("user");
        const reason =
          interaction.options.getString("reason") || "No reason provided";

        const member = await interaction.guild.members.fetch(user.id);

        await member.kick(reason);

        await db(
          `INSERT INTO modlogs
           (guild_id,user_id,moderator_id,action,reason)
           VALUES ($1,$2,$3,'KICK',$4)`,
          [SERVER_ID, user.id, interaction.user.id, reason]
        );

        return replySafe(interaction, {
          content: `👢 ${user.tag} kicked.`,
          ephemeral: true
        });
      }

      /* BAN */

      if (name === "ban") {
        const user = interaction.options.getUser("user");
        const reason =
          interaction.options.getString("reason") || "No reason provided";

        await interaction.guild.members.ban(user, {
          reason
        });

        await db(
          `INSERT INTO modlogs
           (guild_id,user_id,moderator_id,action,reason)
           VALUES ($1,$2,$3,'BAN',$4)`,
          [SERVER_ID, user.id, interaction.user.id, reason]
        );

        return replySafe(interaction, {
          content: `🔨 ${user.tag} banned.`,
          ephemeral: true
        });
      }

      /* UNBAN */

      if (name === "unban") {
        const id = interaction.options.getString("userid");

        await interaction.guild.members.unban(id);

        return replySafe(interaction, {
          content: `🔓 User ${id} unbanned.`,
          ephemeral: true
        });
      }

      /* MODLOGS */

      if (name === "modlogs") {
        const user = interaction.options.getUser("user");

        const result = await db(
          `SELECT * FROM modlogs
           WHERE guild_id=$1 AND user_id=$2
           ORDER BY created_at DESC LIMIT 15`,
          [SERVER_ID, user.id]
        );

        if (!result.rowCount) {
          return replySafe(interaction, {
            content: "No moderation records found.",
            ephemeral: true
          });
        }

        const text = result.rows
          .map(m =>
            `**${m.action}** — ${m.reason || "No reason"} — <@${m.moderator_id}>`
          )
          .join("\n");

        return replySafe(interaction, {
          embeds: [
            new EmbedBuilder()
              .setTitle(`📋 Moderation Logs — ${user.tag}`)
              .setDescription(text.slice(0, 4000))
          ],
          ephemeral: true
        });
      }

      /* AUTOMOD */

      if (name === "automod") {
        const setting = interaction.options.getString("setting");

        if (!setting) {
          const result = await db(
            "SELECT * FROM settings WHERE guild_id=$1",
            [SERVER_ID]
          );

          const s = result.rows[0];

          return replySafe(interaction, {
            embeds: [
              new EmbedBuilder()
                .setTitle("🛡️ AutoMod Status")
                .addFields(
                  { name: "AutoMod", value: s.automod ? "🟢 ON" : "🔴 OFF" },
                  { name: "Spam", value: s.spam ? "🟢 ON" : "🔴 OFF" },
                  { name: "Links", value: s.links ? "🟢 ON" : "🔴 OFF" },
                  { name: "Invites", value: s.invites ? "🟢 ON" : "🔴 OFF" },
                  { name: "Mentions", value: s.mentions ? "🟢 ON" : "🔴 OFF" },
                  { name: "Bad Words", value: s.badwords ? "🟢 ON" : "🔴 OFF" },
                  { name: "Auto Timeout", value: s.auto_timeout ? "🟢 ON" : "🔴 OFF" }
                )
            ],
            ephemeral: true
          });
        }

        await db(
          "UPDATE settings SET automod=$1 WHERE guild_id=$2",
          [setting === "on", SERVER_ID]
        );

        return replySafe(interaction, {
          content: `🛡️ AutoMod ${setting === "on" ? "enabled" : "disabled"}.`,
          ephemeral: true
        });
      }

      /* SECURITY */

      if (name === "security") {
        return replySafe(interaction, {
          embeds: [
            new EmbedBuilder()
              .setTitle("🔐 Grand Mafia Security")
              .setDescription(
                "Security systems are active.\n\n" +
                "🛡️ Anti-spam\n" +
                "🚫 Mass mention protection\n" +
                "🔗 Link filtering\n" +
                "🤬 Word filtering\n" +
                "⏰ Automatic timeout\n" +
                "🚨 Raid protection"
              )
          ],
          ephemeral: true
        });
      }

      /* ANNOUNCE */

      if (name === "announce") {
        const message = interaction.options.getString("message");
        const image = interaction.options.getAttachment("image");

        await interaction.deferReply({ ephemeral: true });

        const embed = new EmbedBuilder()
          .setTitle("📢 Grand Mafia Announcement")
          .setDescription(message)
          .setTimestamp()
          .setFooter({
            text: `Posted by ${interaction.user.tag}`
          });

        if (image) embed.setImage(image.url);

        await interaction.channel.send({
          embeds: [embed]
        });

        return interaction.editReply("✅ Announcement sent.");
      }

      /* SAY */

      if (name === "say") {
        const message = interaction.options.getString("message");
        const image = interaction.options.getAttachment("image");

        await interaction.deferReply({ ephemeral: true });

        await interaction.channel.send({
          content: message,
          files: image ? [image.url] : []
        });

        return interaction.editReply("✅ Message sent.");
      }

      /* ADMIN STATS */

      if (name === "admin-stats") {
        const tickets = await db(
          `SELECT COUNT(*)::int AS count
           FROM tickets WHERE guild_id=$1`,
          [SERVER_ID]
        );

        const open = await db(
          `SELECT COUNT(*)::int AS count
           FROM tickets WHERE guild_id=$1
           AND status IN ('open','hold')`,
          [SERVER_ID]
        );

        const warnings = await db(
          `SELECT COUNT(*)::int AS count
           FROM warnings WHERE guild_id=$1`,
          [SERVER_ID]
        );

        return replySafe(interaction, {
          embeds: [
            new EmbedBuilder()
              .setTitle("📊 Grand Mafia Admin Statistics")
              .addFields(
                {
                  name: "🎫 Total Tickets",
                  value: String(tickets.rows[0].count),
                  inline: true
                },
                {
                  name: "🟢 Open Tickets",
                  value: String(open.rows[0].count),
                  inline: true
                },
                {
                  name: "⚠️ Warnings",
                  value: String(warnings.rows[0].count),
                  inline: true
                }
              )
          ],
          ephemeral: true
        });
      }

      /* PLAYER */

      if (name === "player") {
        const user = interaction.options.getUser("user");

        const warnings = await db(
          `SELECT COUNT(*)::int AS count
           FROM warnings WHERE guild_id=$1 AND user_id=$2`,
          [SERVER_ID, user.id]
        );

        const tickets = await db(
          `SELECT COUNT(*)::int AS count
           FROM tickets WHERE guild_id=$1 AND user_id=$2`,
          [SERVER_ID, user.id]
        );

        return replySafe(interaction, {
          embeds: [
            new EmbedBuilder()
              .setTitle(`👤 Player Information`)
              .setThumbnail(user.displayAvatarURL())
              .addFields(
                { name: "Username", value: user.tag, inline: true },
                { name: "ID", value: user.id, inline: true },
                {
                  name: "Warnings",
                  value: String(warnings.rows[0].count),
                  inline: true
                },
                {
                  name: "Tickets",
                  value: String(tickets.rows[0].count),
                  inline: true
                }
              )
          ],
          ephemeral: true
        });
      }

      /* SLOWMODE */

      if (name === "slowmode") {
        const seconds = interaction.options.getInteger("seconds");

        await interaction.channel.setRateLimitPerUser(seconds);

        return replySafe(interaction, {
          content: `🐌 Slowmode set to ${seconds} seconds.`,
          ephemeral: true
        });
      }

      /* LOCK */

      if (name === "lock") {
        await interaction.channel.permissionOverwrites.edit(
          interaction.guild.roles.everyone,
          { SendMessages: false }
        );

        await interaction.channel.send("🔒 Channel locked.");

        return replySafe(interaction, {
          content: "✅ Channel locked.",
          ephemeral: true
        });
      }

      /* UNLOCK */

      if (name === "unlock") {
        await interaction.channel.permissionOverwrites.edit(
          interaction.guild.roles.everyone,
          { SendMessages: null }
        );

        await interaction.channel.send("🔓 Channel unlocked.");

        return replySafe(interaction, {
          content: "✅ Channel unlocked.",
          ephemeral: true
        });
      }
    }

    /* =====================================================
       BUTTONS
    ===================================================== */

    if (interaction.isButton()) {

      const parts = interaction.customId.split("_");
      const action = parts[1];
      const ticketId = parts[2];

      if (!interaction.member || !isStaff(interaction.member)) {
        return replySafe(interaction, {
          content: "❌ Staff only.",
          ephemeral: true
        });
      }

      const ticket = await getTicketById(ticketId);

      if (!ticket) {
        return replySafe(interaction, {
          content: "❌ Ticket not found.",
          ephemeral: true
        });
      }

      if (action === "claim") {
        await db(
          "UPDATE tickets SET claimed_by=$1, updated_at=NOW() WHERE id=$2",
          [interaction.user.id, ticket.id]
        );

        await interaction.channel.send(
          `🎫 Ticket claimed by ${interaction.user}.`
        );

        return replySafe(interaction, {
          content: "✅ Claimed.",
          ephemeral: true
        });
      }

      if (action === "hold") {
        await db(
          `UPDATE tickets SET status='hold',held=true,updated_at=NOW()
           WHERE id=$1`,
          [ticket.id]
        );

        return replySafe(interaction, {
          content: "⏸️ Ticket placed on hold.",
          ephemeral: true
        });
      }

      if (action === "resume") {
        await db(
          `UPDATE tickets SET status='open',held=false,updated_at=NOW()
           WHERE id=$1`,
          [ticket.id]
        );

        return replySafe(interaction, {
          content: "▶️ Ticket resumed.",
          ephemeral: true
        });
      }

      if (action === "close") {
        await db(
          `UPDATE tickets
           SET status='closed',closed_at=NOW(),updated_at=NOW()
           WHERE id=$1`,
          [ticket.id]
        );

        await interaction.channel.send(
          `🔴 Ticket #${ticket.id} closed by ${interaction.user}.`
        );

        return replySafe(interaction, {
          content: "✅ Ticket closed.",
          ephemeral: true
        });
      }

      if (action === "info") {
        return replySafe(interaction, {
          embeds: [
            new EmbedBuilder()
              .setTitle(`👤 Player Info`)
              .addFields(
                {
                  name: "Player",
                  value: `<@${ticket.user_id}>`
                },
                {
                  name: "Ticket",
                  value: `#${ticket.id}`
                },
                {
                  name: "Status",
                  value: ticket.status
                }
              )
          ],
          ephemeral: true
        });
      }
    }

  } catch (err) {

    console.error("Interaction error:", err);

    await replySafe(interaction, {
      content: "❌ An internal error occurred. Please try again.",
      ephemeral: true
    });
  }
});

/* =========================================================
   MESSAGE HANDLER
========================================================= */

const spamMap = new Map();

const BAD_WORDS = [
  "badword1",
  "badword2"
];

client.on("messageCreate", async message => {

  try {

    /* DM SUPPORT */

    if (!message.guild) {

      if (message.author.bot) return;

      const guild = client.guilds.cache.get(SERVER_ID);

      if (!guild) {
        return message.reply(
          "❌ Support server is currently unavailable."
        );
      }

      const result = await createTicket(message.author, guild);

      if (result.existing) {
        await message.reply(
          `🎫 You already have an open ticket: <#${result.ticket.channel_id}>`
        );
      } else {
        await message.reply(
          `✅ Your support ticket has been created: <#${result.ticket.channel_id}>`
        );
      }

      const ticket = result.ticket;

      await db(
        `INSERT INTO ticket_messages
         (ticket_id,user_id,direction,content,attachment_urls)
         VALUES ($1,$2,'PLAYER_TO_STAFF',$3,$4)`,
        [
          ticket.id,
          message.author.id,
          message.content || "[attachment]",
          message.attachments.map(a => a.url).join("\n")
        ]
      );

      return;
    }

    if (message.author.bot) return;
    if (message.guild.id !== SERVER_ID) return;

    const settingsResult = await db(
      "SELECT * FROM settings WHERE guild_id=$1",
      [SERVER_ID]
    );

    const settings = settingsResult.rows[0];

    /* STAFF EXEMPTION */

    const member = message.member;

    if (member && isStaff(member)) return;

    /* MASS MENTION */

    if (
      settings.automod &&
      settings.mentions &&
      message.mentions.users.size +
      message.mentions.roles.size >= 5
    ) {

      await message.delete().catch(() => {});

      await db(
        `INSERT INTO modlogs
         (guild_id,user_id,moderator_id,action,reason)
         VALUES ($1,$2,'AUTO','AUTO_TIMEOUT',$3)`,
        [
          SERVER_ID,
          message.author.id,
          "Mass mention protection"
        ]
      );

      await member.timeout(
        5 * 60 * 1000,
        "Mass mention protection"
      ).catch(() => {});

      await logAction(
        message.guild,
        "🚫 Mass Mention Protection",
        `${message.author} automatically timed out.`,
        [{ name: "Duration", value: "5 minutes" }]
      );

      return;
    }

    /* INVITE FILTER */

    const inviteRegex =
      /(discord\.gg\/|discord\.com\/invite\/)/i;

    if (
      settings.automod &&
      settings.invites &&
      inviteRegex.test(message.content)
    ) {

      await message.delete().catch(() => {});

      await member.timeout(
        2 * 60 * 1000,
        "Discord invite filtering"
      ).catch(() => {});

      await logAction(
        message.guild,
        "🔗 Invite Filter",
        `${message.author} posted a Discord invite.`
      );

      return;
    }

    /* LINK FILTER */

    const urlRegex =
      /https?:\/\/[^\s]+/i;

    if (
      settings.automod &&
      settings.links &&
      urlRegex.test(message.content)
    ) {

      await message.delete().catch(() => {});

      await logAction(
        message.guild,
        "🔗 Link Filter",
        `${message.author} posted a link.`
      );

      return;
    }

    /* BAD WORD FILTER */

    if (
      settings.automod &&
      settings.badwords &&
      BAD_WORDS.some(word =>
        message.content.toLowerCase().includes(word)
      )
    ) {

      await message.delete().catch(() => {});

      await member.timeout(
        60 * 1000,
        "Automatic word filter"
      ).catch(() => {});

      await logAction(
        message.guild,
        "🤬 Word Filter",
        `${message.author} triggered the word filter.`
      );

      return;
    }

    /* SPAM */

    if (settings.automod && settings.spam) {

      const now = Date.now();
      const data = spamMap.get(message.author.id) || [];

      const recent = data.filter(
        time => now - time < 5000
      );

      recent.push(now);
      spamMap.set(message.author.id, recent);

      if (recent.length >= 6) {

        spamMap.delete(message.author.id);

        await member.timeout(
          60 * 1000,
          "Automatic spam protection"
        ).catch(() => {});

        await logAction(
          message.guild,
          "🚨 Anti-Spam",
          `${message.author} automatically timed out for spam.`,
          [{ name: "Duration", value: "1 minute" }]
        );
      }
    }

    /* SAVE TICKET MESSAGE */

    const ticketResult = await db(
      `SELECT * FROM tickets
       WHERE channel_id=$1
       AND status IN ('open','hold')
       LIMIT 1`,
      [message.channel.id]
    );

    if (ticketResult.rowCount) {

      const ticket = ticketResult.rows[0];

      await db(
        `INSERT INTO ticket_messages
         (ticket_id,user_id,direction,content,attachment_urls)
         VALUES ($1,$2,'STAFF_TO_PLAYER',$3,$4)`,
        [
          ticket.id,
          message.author.id,
          message.content || "[attachment]",
          message.attachments.map(a => a.url).join("\n")
        ]
      );

      await db(
        "UPDATE tickets SET updated_at=NOW() WHERE id=$1",
        [ticket.id]
      );

      if (message.author.id !== ticket.user_id) {

        try {

          const user = await client.users.fetch(ticket.user_id);

          if (message.content) {
            await user.send({
              content: `💬 **Support:** ${message.content}`,
              files: message.attachments.map(a => a.url)
            });
          } else {
            await user.send({
              content: "📎 Support sent an attachment:",
              files: message.attachments.map(a => a.url)
            });
          }

        } catch {
          await message.channel.send(
            "⚠️ I couldn't DM the player. Their DMs may be disabled."
          );
        }
      }
    }

  } catch (err) {
    console.error("Message error:", err.message);
  }
});

/* =========================================================
   AUTOMATIC INACTIVITY CLOSING
========================================================= */

setInterval(async () => {

  try {

    const result = await db(`
      SELECT * FROM tickets
      WHERE status IN ('open','hold')
      AND updated_at < NOW() - INTERVAL '48 hours'
    `);

    for (const ticket of result.rows) {

      await db(
        `UPDATE tickets
         SET status='closed',closed_at=NOW(),updated_at=NOW()
         WHERE id=$1`,
        [ticket.id]
      );

      const guild = client.guilds.cache.get(ticket.guild_id);

      if (!guild) continue;

      const channel = guild.channels.cache.get(ticket.channel_id);

      if (channel) {
        await channel.send(
          `⏰ Ticket #${ticket.id} automatically closed because of inactivity.`
        );
      }

      await logAction(
        guild,
        "⏰ Automatic Ticket Closure",
        `Ticket #${ticket.id} closed after inactivity.`
      );
    }

  } catch (err) {
    console.error("Inactivity check error:", err.message);
  }

}, 30 * 60 * 1000);

/* =========================================================
   ERROR HANDLING
========================================================= */

process.on("unhandledRejection", err => {
  console.error("Unhandled rejection:", err);
});

process.on("uncaughtException", err => {
  console.error("Uncaught exception:", err);
});

/* =========================================================
   START
========================================================= */

(async () => {

  try {

    await initDatabase();

    await client.login(TOKEN);

  } catch (err) {

    console.error("❌ Startup failed:", err);

    process.exit(1);
  }

})();
