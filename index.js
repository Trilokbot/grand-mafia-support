const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  PermissionsBitField
} = require("discord.js");

const express = require("express");
const { Pool } = require("pg");

// ======================================================
// CONFIG
// ======================================================

const TOKEN = process.env.DISCORD_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

const GUILD_ID = "1493700265499689154";
const SUPPORT_ROLE_ID = "1542498406981959801";
const LOG_CHANNEL_ID = "1542500573000106024";

// Automatic timeout for inactive tickets
const INACTIVITY_HOURS = 24;

// Anti-spam
const SPAM_WINDOW_MS = 5000;
const SPAM_LIMIT = 5;

// ======================================================
// CHECK ENVIRONMENT
// ======================================================

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN is missing!");
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL is missing!");
  process.exit(1);
}

// ======================================================
// WEB SERVER FOR RENDER
// ======================================================

const app = express();

app.get("/", (req, res) => {
  res.send("Grand Mafia RP Support Bot is Online!");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// ======================================================
// POSTGRESQL
// ======================================================

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function databaseSetup() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id SERIAL PRIMARY KEY,
      player_id TEXT UNIQUE NOT NULL,
      player_tag TEXT,
      admin_id TEXT,
      admin_tag TEXT,
      status TEXT DEFAULT 'open',
      priority TEXT DEFAULT 'normal',
      category TEXT DEFAULT 'general',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      claimed_at TIMESTAMP,
      closed_at TIMESTAMP,
      hold_at TIMESTAMP,
      last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ticket_messages (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL,
      sender_tag TEXT,
      sender_type TEXT NOT NULL,
      content TEXT,
      attachment_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ticket_notes (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
      admin_id TEXT NOT NULL,
      admin_tag TEXT,
      note TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ticket_history (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      actor_id TEXT,
      actor_tag TEXT,
      details TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS blocked_players (
      player_id TEXT PRIMARY KEY,
      player_tag TEXT,
      blocked_by TEXT,
      reason TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ratings (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
      player_id TEXT,
      rating INTEGER,
      feedback TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_stats (
      admin_id TEXT PRIMARY KEY,
      admin_tag TEXT,
      claimed INTEGER DEFAULT 0,
      closed INTEGER DEFAULT 0,
      messages INTEGER DEFAULT 0
    );
  `);

  console.log("✅ PostgreSQL database ready!");
}

// ======================================================
// DISCORD CLIENT
// ======================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ======================================================
// IN-MEMORY ANTI-SPAM
// ======================================================

const spamTracker = new Map();

// ======================================================
// DATABASE HELPERS
// ======================================================

async function getTicket(playerId) {
  const result = await pool.query(
    `SELECT * FROM tickets
     WHERE player_id = $1
     AND status != 'closed'
     ORDER BY id DESC
     LIMIT 1`,
    [playerId]
  );

  return result.rows[0] || null;
}

async function getTicketById(ticketId) {
  const result = await pool.query(
    `SELECT * FROM tickets WHERE id = $1`,
    [ticketId]
  );

  return result.rows[0] || null;
}

async function addHistory(
  ticketId,
  action,
  actorId,
  actorTag,
  details = ""
) {
  await pool.query(
    `INSERT INTO ticket_history
    (ticket_id, action, actor_id, actor_tag, details)
    VALUES ($1,$2,$3,$4,$5)`,
    [
      ticketId,
      action,
      actorId || null,
      actorTag || null,
      details
    ]
  );
}

async function addMessage(
  ticketId,
  senderId,
  senderTag,
  senderType,
  content,
  attachmentUrl = null
) {
  await pool.query(
    `INSERT INTO ticket_messages
    (ticket_id, sender_id, sender_tag, sender_type, content, attachment_url)
    VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      ticketId,
      senderId,
      senderTag,
      senderType,
      content || "",
      attachmentUrl
    ]
  );

  await pool.query(
    `UPDATE tickets
     SET last_activity = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [ticketId]
  );
}

// ======================================================
// LOGGING
// ======================================================

async function sendLog(text) {
  try {
    const channel =
      await client.channels.fetch(LOG_CHANNEL_ID);

    if (channel && channel.isTextBased()) {
      await channel.send(text);
    }
  } catch (error) {
    console.error("❌ Log error:", error.message);
  }
}

// ======================================================
// ADMIN STATISTICS
// ======================================================

async function adminClaimed(adminId, adminTag) {
  await pool.query(`
    INSERT INTO admin_stats
    (admin_id, admin_tag, claimed)
    VALUES ($1,$2,1)
    ON CONFLICT (admin_id)
    DO UPDATE SET
      admin_tag = $2,
      claimed = admin_stats.claimed + 1
  `, [adminId, adminTag]);
}

async function adminClosed(adminId, adminTag) {
  await pool.query(`
    INSERT INTO admin_stats
    (admin_id, admin_tag, closed)
    VALUES ($1,$2,1)
    ON CONFLICT (admin_id)
    DO UPDATE SET
      admin_tag = $2,
      closed = admin_stats.closed + 1
  `, [adminId, adminTag]);
}

async function adminMessage(adminId, adminTag) {
  await pool.query(`
    INSERT INTO admin_stats
    (admin_id, admin_tag, messages)
    VALUES ($1,$2,1)
    ON CONFLICT (admin_id)
    DO UPDATE SET
      admin_tag = $2,
      messages = admin_stats.messages + 1
  `, [adminId, adminTag]);
}

// ======================================================
// BOT READY
// ======================================================

client.once(Events.ClientReady, async () => {

  console.log("================================");
  console.log(`✅ BOT ONLINE: ${client.user.tag}`);
  console.log("================================");

  try {
    await databaseSetup();
  } catch (error) {
    console.error(
      "❌ Database setup failed:",
      error
    );
  }

});

// ======================================================
// MAIN DM SYSTEM
// ======================================================

client.on(Events.MessageCreate, async message => {

  if (message.author.bot) return;
  if (message.guild) return;

  try {

    const user = message.author;

    // ==================================================
    // GET GUILD MEMBER
    // ==================================================

    let isAdmin = false;

    try {

      const guild =
        await client.guilds.fetch(GUILD_ID);

      const member =
        await guild.members.fetch(user.id);

      isAdmin =
        member.roles.cache.has(
          SUPPORT_ROLE_ID
        );

    } catch {

      isAdmin = false;

    }

    // ==================================================
    // ADMIN MESSAGE
    // ==================================================

    if (isAdmin) {

      const ticketResult = await pool.query(
        `SELECT * FROM tickets
         WHERE admin_id = $1
         AND status IN ('open','hold')
         ORDER BY id DESC
         LIMIT 1`,
        [user.id]
      );

      const ticket = ticketResult.rows[0];

      if (!ticket) {

        await user.send(
          "⚠️ You don't currently have a claimed ticket."
        );

        return;
      }

      // ================================================
      // HOLD CHECK
      // ================================================

      if (ticket.status === "hold") {

        await user.send(
          "⏸️ This ticket is currently on hold."
        );

        return;
      }

      // ================================================
      // GET PLAYER
      // ================================================

      const player =
        await client.users.fetch(
          ticket.player_id
        );

      // ================================================
      // SEND TEXT + ATTACHMENTS
      // ================================================

      const files = [];

      for (const attachment of message.attachments.values()) {
        files.push(attachment.url);
      }

      if (message.content) {
        await player.send(message.content);
      }

      if (files.length > 0) {
        await player.send({
          files
        });
      }

      // ================================================
      // SAVE MESSAGE
      // ================================================

      await addMessage(
        ticket.id,
        user.id,
        user.tag,
        "admin",
        message.content,
        files[0] || null
      );

      await adminMessage(
        user.id,
        user.tag
      );

      await message.react("✅");

      await sendLog(
        `💬 **ADMIN MESSAGE**\n` +
        `🎫 Ticket: #${ticket.id}\n` +
        `👮 Admin: ${user.tag}\n` +
        `👤 Player: ${player.tag}\n` +
        `📝 Message: ${message.content || "[Attachment]"}`
      );

      return;
    }

    // ==================================================
    // PLAYER
    // ==================================================

    const player = user;

    // ==================================================
    // CHECK BLOCK
    // ==================================================

    const blocked =
      await pool.query(
        `SELECT * FROM blocked_players
         WHERE player_id = $1`,
        [player.id]
      );

    if (blocked.rows.length > 0) {

      await player.send(
        "🚫 **You are blocked from using Grand Mafia RP Support.**"
      );

      return;
    }

    // ==================================================
    // ANTI-SPAM
    // ==================================================

    const now = Date.now();

    let timestamps =
      spamTracker.get(player.id) || [];

    timestamps =
      timestamps.filter(
        time => now - time < SPAM_WINDOW_MS
      );

    timestamps.push(now);

    spamTracker.set(
      player.id,
      timestamps
    );

    if (timestamps.length > SPAM_LIMIT) {

      await player.send(
        "⚠️ **Please slow down.**\n\n" +
        "Your messages are being sent too quickly. " +
        "Please wait a few seconds."
      );

      return;
    }

    // ==================================================
    // EXISTING TICKET
    // ==================================================

    let ticket =
      await getTicket(player.id);

    if (ticket) {

      // ==============================================
      // HOLD
      // ==============================================

      if (ticket.status === "hold") {

        await player.send(
          "⏸️ Your ticket is currently on hold. " +
          "Please wait for support."
        );

        return;
      }

      // ==============================================
      // FORWARD TO ADMIN
      // ==============================================

      if (ticket.admin_id) {

        try {

          const admin =
            await client.users.fetch(
              ticket.admin_id
            );

          if (message.content) {

            await admin.send(
              `📩 **PLAYER MESSAGE — TICKET #${ticket.id}**\n\n` +
              `${message.content}`
            );

          }

          const files = [];

          for (
            const attachment
            of message.attachments.values()
          ) {
            files.push(attachment.url);
          }

          if (files.length > 0) {

            await admin.send({
              files
            });

          }

          await addMessage(
            ticket.id,
            player.id,
            player.tag,
            "player",
            message.content,
            files[0] || null
          );

        } catch (error) {

          console.error(
            "❌ Failed to forward player message:",
            error.message
          );

        }

      } else {

        await player.send(
          "⏳ Your support request is waiting for an administrator to claim it."
        );

      }

      return;
    }

    // ==================================================
    // CREATE NEW TICKET
    // ==================================================

    const newTicket =
      await pool.query(
        `INSERT INTO tickets
        (player_id, player_tag)
        VALUES ($1,$2)
        RETURNING *`,
        [
          player.id,
          player.tag
        ]
      );

    ticket =
      newTicket.rows[0];

    // Save first message

    const files = [];

    for (
      const attachment
      of message.attachments.values()
    ) {
      files.push(attachment.url);
    }

    await addMessage(
      ticket.id,
      player.id,
      player.tag,
      "player",
      message.content,
      files[0] || null
    );

    await addHistory(
      ticket.id,
      "created",
      player.id,
      player.tag,
      message.content
    );

    // ==================================================
    // FIND SUPPORT ADMINS
    // ==================================================

    const guild =
      await client.guilds.fetch(
        GUILD_ID
      );

    const members =
      await guild.members.fetch();

    const admins =
      members.filter(member =>
        member.roles.cache.has(
          SUPPORT_ROLE_ID
        ) &&
        !member.user.bot
      );

    // ==================================================
    // NO ADMINS
    // ==================================================

    if (admins.size === 0) {

      await player.send(
        "⚠️ **No support administrators are currently available.**\n\n" +
        "Your request has been recorded. Please wait."
      );

      return;
    }

    // ==================================================
    // SEND TICKET TO ADMINS
    // ==================================================

    for (
      const [, admin]
      of admins
    ) {

      try {

        const embed =
          new EmbedBuilder()
            .setTitle(
              `🎫 NEW SUPPORT TICKET #${ticket.id}`
            )
            .setDescription(
              `👤 **Player:** ${player.tag}\n` +
              `🆔 **ID:** ${player.id}\n` +
              `📊 **Status:** 🟡 Waiting\n\n` +
              `💬 **Message:**\n${message.content || "[Attachment]"}`
            )
            .setFooter({
              text:
                "Grand Mafia RP Support"
            });

        const row =
          new ActionRowBuilder()
            .addComponents(

              new ButtonBuilder()
                .setCustomId(
                  `claim_${ticket.id}`
                )
                .setLabel("Claim")
                .setEmoji("🎫")
                .setStyle(
                  ButtonStyle.Primary
                ),

              new ButtonBuilder()
                .setCustomId(
                  `block_${ticket.id}`
                )
                .setLabel("Block")
                .setEmoji("🚫")
                .setStyle(
                  ButtonStyle.Danger
                )

            );

        await admin.send({
          embeds: [embed],
          components: [row]
        });

      } catch (error) {

        console.error(
          `❌ Could not DM ${admin.user.tag}:`,
          error.message
        );

      }

    }

    // ==================================================
    // PLAYER CONFIRMATION
    // ==================================================

    await player.send(
      `👋 **Welcome to Grand Mafia RP Support!**\n\n` +
      `🎫 **Ticket:** #${ticket.id}\n` +
      `🟡 **Status:** Waiting for Support\n\n` +
      `Your request has been sent to our support team.\n` +
      `You can continue sending messages here.`
    );

    await sendLog(
      `🎫 **TICKET CREATED**\n\n` +
      `Ticket: #${ticket.id}\n` +
      `Player: ${player.tag}\n` +
      `ID: ${player.id}`
    );

  } catch (error) {

    console.error(
      "❌ DM system error:",
      error
    );

  }

});

// ======================================================
// BUTTON SYSTEM
// ======================================================

client.on(
  Events.InteractionCreate,
  async interaction => {

    if (!interaction.isButton()) return;

    try {

      const [action, ticketIdText] =
        interaction.customId.split("_");

      const ticketId =
        Number(ticketIdText);

      const ticket =
        await getTicketById(ticketId);

      if (!ticket) {

        return interaction.reply({
          content:
            "❌ Ticket not found.",
          ephemeral: true
        });

      }

      // ==================================================
      // GET MEMBER
      // ==================================================

      const guild =
        await client.guilds.fetch(
          GUILD_ID
        );

      const member =
        await guild.members.fetch(
          interaction.user.id
        );

      const isAdmin =
        member.roles.cache.has(
          SUPPORT_ROLE_ID
        );

      if (!isAdmin) {

        return interaction.reply({
          content:
            "❌ You are not a Support Team member.",
          ephemeral: true
        });

      }

      // ==================================================
      // CLAIM
      // ==================================================

      if (action === "claim") {

        if (ticket.status === "closed") {

          return interaction.reply({
            content:
              "❌ This ticket is already closed.",
            ephemeral: true
          });

        }

        if (ticket.admin_id) {

          return interaction.reply({
            content:
              `⚠️ Already claimed by ${ticket.admin_tag}.`,
            ephemeral: true
          });

        }

        await pool.query(
          `UPDATE tickets
           SET admin_id = $1,
               admin_tag = $2,
               status = 'open',
               claimed_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [
            interaction.user.id,
            interaction.user.tag,
            ticketId
          ]
        );

        await addHistory(
          ticketId,
          "claimed",
          interaction.user.id,
          interaction.user.tag
        );

        await adminClaimed(
          interaction.user.id,
          interaction.user.tag
        );

        await interaction.update({
          content:
            `🟢 **TICKET #${ticketId} CLAIMED**\n\n` +
            `👮 Admin: ${interaction.user.tag}\n\n` +
            `💬 Reply to this DM to communicate with the player.`,
          embeds: [],
          components: []
        });

        const player =
          await client.users.fetch(
            ticket.player_id
          );

        await player.send(
          "👮 **Support has joined your request!**\n\n" +
          "💬 You can now continue your conversation here."
        );

        await sendLog(
          `🎫 **TICKET CLAIMED**\n\n` +
          `Ticket: #${ticketId}\n` +
          `Player: ${ticket.player_tag}\n` +
          `Admin: ${interaction.user.tag}`
        );

        return;
      }

      // ==================================================
      // BLOCK
      // ==================================================

      if (action === "block") {

        await pool.query(
          `INSERT INTO blocked_players
          (player_id, player_tag, blocked_by, reason)
          VALUES ($1,$2,$3,$4)
          ON CONFLICT (player_id)
          DO NOTHING`,
          [
            ticket.player_id,
            ticket.player_tag,
            interaction.user.tag,
            "Support block"
          ]
        );

        await addHistory(
          ticketId,
          "player_blocked",
          interaction.user.id,
          interaction.user.tag
        );

        await interaction.reply({
          content:
            `🚫 ${ticket.player_tag} has been blocked from support.`,
          ephemeral: true
        });

        await sendLog(
          `🚫 **PLAYER BLOCKED**\n\n` +
          `Player: ${ticket.player_tag}\n` +
          `ID: ${ticket.player_id}\n` +
          `By: ${interaction.user.tag}`
        );

        return;
      }

    } catch (error) {

      console.error(
        "❌ Button error:",
        error
      );

      if (!interaction.replied) {

        await interaction.reply({
          content:
            "❌ Something went wrong.",
          ephemeral: true
        });

      }

    }

  }
);

// ======================================================
// SLASH COMMANDS
// ======================================================

client.once(Events.ClientReady, async () => {

  try {

    const guild =
      await client.guilds.fetch(
        GUILD_ID
      );

    await guild.commands.set([

      {
        name: "close",
        description: "Close your current support ticket"
      },

      {
        name: "reopen",
        description: "Reopen your last support ticket"
      },

      {
        name: "hold",
        description: "Put your current ticket on hold"
      },

      {
        name: "unhold",
        description: "Resume your current ticket"
      },

      {
        name: "transfer",
        description: "Transfer your current ticket"
      },

      {
        name: "note",
        description: "Add an internal ticket note",
        options: [
          {
            name: "text",
            description: "Internal note",
            type: 3,
            required: true
          }
        ]
      },

      {
        name: "ticket-info",
        description: "View ticket information"
      },

      {
        name: "ticket-history",
        description: "View ticket history"
      },

      {
        name: "player-info",
        description: "View player information"
      },

      {
        name: "block",
        description: "Block a player from support",
        options: [
          {
            name: "player",
            description: "Player ID",
            type: 3,
            required: true
          },
          {
            name: "reason",
            description: "Reason",
            type: 3,
            required: false
          }
        ]
      },

      {
        name: "unblock",
        description: "Unblock a player",
        options: [
          {
            name: "player",
            description: "Player ID",
            type: 3,
            required: true
          }
        ]
      },

      {
        name: "admin-stats",
        description: "View your support statistics"
      },

      {
        name: "support",
        description: "Show support information"
      }

    ]);

    console.log(
      "✅ Slash commands registered!"
    );

  } catch (error) {

    console.error(
      "❌ Command registration failed:",
      error
    );

  }

});

// ======================================================
// SLASH COMMAND HANDLER
// ======================================================

client.on(
  Events.InteractionCreate,
  async interaction => {

    if (!interaction.isChatInputCommand())
      return;

    try {

      const command =
        interaction.commandName;

      // ==================================================
      // SUPPORT
      // ==================================================

      if (command === "support") {

        return interaction.reply({
          content:
            "🎫 **Grand Mafia RP Support**\n\n" +
            "Players can DM the support bot to create a ticket.\n" +
            "Support staff can claim tickets from their DMs.",
          ephemeral: true
        });

      }

      // ==================================================
      // ADMIN CHECK
      // ==================================================

      let isAdmin = false;

      if (interaction.guild) {

        isAdmin =
          interaction.member.roles.cache.has(
            SUPPORT_ROLE_ID
          );

      }

      // ==================================================
      // CLOSE
      // ==================================================

      if (command === "close") {

        const ticket =
          await getTicket(
            interaction.user.id
          );

        if (!ticket) {

          return interaction.reply({
            content:
              "❌ No active ticket found.",
            ephemeral: true
          });

        }

        if (
          !isAdmin &&
          ticket.player_id !== interaction.user.id
        ) {

          return interaction.reply({
            content:
              "❌ You cannot close this ticket.",
            ephemeral: true
          });

        }

        await pool.query(
          `UPDATE tickets
           SET status = 'closed',
               closed_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [ticket.id]
        );

        await addHistory(
          ticket.id,
          "closed",
          interaction.user.id,
          interaction.user.tag
        );

        if (ticket.admin_id) {

          await adminClosed(
            ticket.admin_id,
            ticket.admin_tag
          );

        }

        await interaction.reply({
          content:
            `🔴 Ticket #${ticket.id} has been closed.`,
          ephemeral: true
        });

        try {

          const player =
            await client.users.fetch(
              ticket.player_id
            );

          await player.send(
            `🔴 **Ticket #${ticket.id} closed.**\n\n` +
            "Thank you for contacting Grand Mafia RP Support.\n\n" +
            "⭐ Please use the support rating system if available."
          );

        } catch {}

        await sendLog(
          `🔴 **TICKET CLOSED**\n\n` +
          `Ticket: #${ticket.id}\n` +
          `Player: ${ticket.player_tag}\n` +
          `Closed by: ${interaction.user.tag}`
        );

        return;
      }

      // ==================================================
      // HOLD
      // ==================================================

      if (command === "hold") {

        if (!isAdmin) {

          return interaction.reply({
            content:
              "❌ Support staff only.",
            ephemeral: true
          });

        }

        const ticket =
          await pool.query(
            `SELECT * FROM tickets
             WHERE admin_id = $1
             AND status = 'open'
             LIMIT 1`,
            [interaction.user.id]
          );

        if (!ticket.rows[0]) {

          return interaction.reply({
            content:
              "❌ You don't have an active ticket.",
            ephemeral: true
          });

        }

        const t =
          ticket.rows[0];

        await pool.query(
          `UPDATE tickets
           SET status = 'hold',
               hold_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [t.id]
        );

        await addHistory(
          t.id,
          "hold",
          interaction.user.id,
          interaction.user.tag
        );

        await interaction.reply({
          content:
            `⏸️ Ticket #${t.id} is now on hold.`,
          ephemeral: true
        });

        return;
      }

      // ==================================================
      // UNHOLD
      // ==================================================

      if (command === "unhold") {

        if (!isAdmin) {

          return interaction.reply({
            content:
              "❌ Support staff only.",
            ephemeral: true
          });

        }

        const result =
          await pool.query(
            `SELECT * FROM tickets
             WHERE admin_id = $1
             AND status = 'hold'
             LIMIT 1`,
            [interaction.user.id]
          );

        if (!result.rows[0]) {

          return interaction.reply({
            content:
              "❌ You don't have a ticket on hold.",
            ephemeral: true
          });

        }

        const t =
          result.rows[0];

        await pool.query(
          `UPDATE tickets
           SET status = 'open'
           WHERE id = $1`,
          [t.id]
        );

        await addHistory(
          t.id,
          "unhold",
          interaction.user.id,
          interaction.user.tag
        );

        await interaction.reply({
          content:
            `▶️ Ticket #${t.id} resumed.`,
          ephemeral: true
        });

        return;
      }

      // ==================================================
      // NOTE
      // ==================================================

      if (command === "note") {

        if (!is
