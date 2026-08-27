const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const express = require("express");
const { Pool } = require("pg");

/* ================= CONFIG ================= */

const TOKEN = process.env.DISCORD_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

const GUILD_ID = "1493700265499689154";
const SUPPORT_ROLE_ID = "1542498406981959801";
const LOG_CHANNEL_ID = "1542500573000106024";

const INACTIVITY_HOURS = 24;
const SPAM_LIMIT = 5;
const SPAM_WINDOW = 10000;

/* ================= ENV CHECK ================= */

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN is missing.");
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL is missing.");
  process.exit(1);
}

/* ================= WEB SERVER ================= */

const app = express();

app.get("/", (req, res) => {
  res.send("Grand Mafia RP Support Bot Online");
});

app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("🌐 Web server started");
});

/* ================= DATABASE ================= */

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function setupDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id SERIAL PRIMARY KEY,
      player_id TEXT UNIQUE NOT NULL,
      player_tag TEXT,
      admin_id TEXT,
      admin_tag TEXT,
      status TEXT DEFAULT 'open',
      category TEXT DEFAULT 'general',
      priority TEXT DEFAULT 'normal',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      claimed_at TIMESTAMP,
      closed_at TIMESTAMP,
      hold_at TIMESTAMP,
      last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ticket_messages (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
      sender_id TEXT,
      sender_tag TEXT,
      sender_type TEXT,
      content TEXT,
      attachment_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ticket_history (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
      action TEXT,
      actor_id TEXT,
      actor_tag TEXT,
      details TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ticket_notes (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
      admin_id TEXT,
      admin_tag TEXT,
      note TEXT,
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
      messages INTEGER DEFAULT 0,
      transferred INTEGER DEFAULT 0
    );
  `);

  console.log("✅ PostgreSQL database ready");
}

/* ================= DISCORD ================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [
    Partials.Channel
  ]
});

/* ================= MEMORY ================= */

const activeTickets = new Map();
const spamTracker = new Map();

/* ================= HELPERS ================= */

async function getTicketByPlayer(playerId) {
  const result = await pool.query(
    `
    SELECT *
    FROM tickets
    WHERE player_id = $1
    AND status != 'closed'
    ORDER BY id DESC
    LIMIT 1
    `,
    [playerId]
  );

  return result.rows[0] || null;
}

async function getTicket(ticketId) {
  const result = await pool.query(
    `
    SELECT *
    FROM tickets
    WHERE id = $1
    `,
    [ticketId]
  );

  return result.rows[0] || null;
}

async function isAdmin(userId) {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(userId);

    return member.roles.cache.has(SUPPORT_ROLE_ID);
  } catch {
    return false;
  }
}

async function saveHistory(
  ticketId,
  action,
  actorId,
  actorTag,
  details = ""
) {
  await pool.query(
    `
    INSERT INTO ticket_history
    (ticket_id, action, actor_id, actor_tag, details)
    VALUES ($1,$2,$3,$4,$5)
    `,
    [
      ticketId,
      action,
      actorId || null,
      actorTag || null,
      details
    ]
  );
}

async function saveMessage(
  ticketId,
  senderId,
  senderTag,
  senderType,
  content,
  attachment = null
) {
  await pool.query(
    `
    INSERT INTO ticket_messages
    (ticket_id, sender_id, sender_tag,
     sender_type, content, attachment_url)
    VALUES ($1,$2,$3,$4,$5,$6)
    `,
    [
      ticketId,
      senderId,
      senderTag,
      senderType,
      content || "",
      attachment || null
    ]
  );

  await pool.query(
    `
    UPDATE tickets
    SET last_activity = CURRENT_TIMESTAMP
    WHERE id = $1
    `,
    [ticketId]
  );
}

async function sendLog(message) {
  try {
    const channel =
      await client.channels.fetch(LOG_CHANNEL_ID);

    if (channel && channel.isTextBased()) {
      await channel.send(message);
    }
  } catch (error) {
    console.error(
      "❌ Log error:",
      error.message
    );
  }
}

async function getAttachments(message) {
  const files = [];

  for (
    const attachment
    of message.attachments.values()
  ) {
    files.push(attachment.url);
  }

  return files;
}

async function updateAdminStats(
  adminId,
  adminTag,
  field
) {
  const allowed = [
    "claimed",
    "closed",
    "messages",
    "transferred"
  ];

  if (!allowed.includes(field)) return;

  await pool.query(
    `
    INSERT INTO admin_stats
    (admin_id, admin_tag, ${field})
    VALUES ($1,$2,1)

    ON CONFLICT (admin_id)
    DO UPDATE SET
    admin_tag = $2,
    ${field} = admin_stats.${field} + 1
    `,
    [adminId, adminTag]
  );
}

/* ================= READY ================= */

client.once(
  Events.ClientReady,
  async () => {

    console.log(
      "================================"
    );

    console.log(
      `🤖 Bot Online: ${client.user.tag}`
    );

    console.log(
      "================================"
    );

    try {
      await setupDatabase();

      await registerCommands();

      console.log(
        "🎫 Support system ready"
      );

    } catch (error) {

      console.error(
        "❌ Startup error:",
        error
      );
    }
  }
);

/* ================= SLASH COMMANDS ================= */

async function registerCommands() {

  const guild =
    await client.guilds.fetch(
      GUILD_ID
    );

  await guild.commands.set([

    {
      name: "support",
      description:
        "Show Grand Mafia RP support information"
    },

    {
      name: "tickets",
      description:
        "View open support tickets"
    },

    {
      name: "close",
      description:
        "Close your current ticket"
    },

    {
      name: "reopen",
      description:
        "Reopen a ticket"
    },

    {
      name: "hold",
      description:
        "Put your current ticket on hold"
    },

    {
      name: "unhold",
      description:
        "Remove hold from your ticket"
    },

    {
      name: "ticket-info",
      description:
        "View ticket information"
    },

    {
      name: "ticket-history",
      description:
        "View ticket history"
    },

    {
      name: "note",
      description:
        "Add an internal ticket note",
      options: [
        {
          name: "text",
          description:
            "Internal note",
          type: 3,
          required: true
        }
      ]
    },

    {
      name: "notes",
      description:
        "View internal ticket notes"
    },

    {
      name: "transcript",
      description:
        "Create a ticket transcript"
    },

    {
      name: "block",
      description:
        "Block a player from support",
      options: [
        {
          name: "player",
          description:
            "Player Discord ID",
          type: 3,
          required: true
        },
        {
          name: "reason",
          description:
            "Reason",
          type: 3,
          required: false
        }
      ]
    },

    {
      name: "unblock",
      description:
        "Unblock a player",
      options: [
        {
          name: "player",
          description:
            "Player Discord ID",
          type: 3,
          required: true
        }
      ]
    },

    {
      name: "player-info",
      description:
        "View player support information",
      options: [
        {
          name: "player",
          description:
            "Player Discord ID",
          type: 3,
          required: true
        }
      ]
    },

    {
      name: "admin-stats",
      description:
        "View support statistics"
    }

  ]);

  console.log(
    "✅ Slash commands registered"
  );
}

/* ================= DM MESSAGE SYSTEM ================= */

client.on(
  Events.MessageCreate,
  async message => {

    if (message.author.bot) return;

    if (message.guild) return;

    try {

      const user =
        message.author;

      const admin =
        await isAdmin(user.id);

      if (admin) {

        await handleAdminDM(
          message
        );

      } else {

        await handlePlayerDM(
          message
        );
      }

    } catch (error) {

      console.error(
        "❌ DM system error:",
        error
      );
    }
  }
);

/* ================= PLAYER DM ================= */

async function handlePlayerDM(message) {

  const player =
    message.author;

  /* Block check */

  const blocked =
    await pool.query(
      `
      SELECT *
      FROM blocked_players
      WHERE player_id = $1
      `,
      [player.id]
    );

  if (blocked.rows.length) {

    await player.send(
      "🚫 You are blocked from using Grand Mafia RP Support."
    );

    return;
  }

  /* Anti spam */

  const now =
    Date.now();

  let timestamps =
    spamTracker.get(player.id) || [];

  timestamps =
    timestamps.filter(
      time =>
        now - time < SPAM_WINDOW
    );

  timestamps.push(now);

  spamTracker.set(
    player.id,
    timestamps
  );

  if (
    timestamps.length >
    SPAM_LIMIT
  ) {

    await player.send(
      "⚠️ Please slow down. Too many messages were sent."
    );

    return;
  }

  /* Find ticket */

  let ticket =
    await getTicketByPlayer(
      player.id
    );

  /* Create ticket */

  if (!ticket) {

    const result =
      await pool.query(
        `
        INSERT INTO tickets
        (player_id, player_tag)
        VALUES ($1,$2)
        RETURNING *
        `,
        [
          player.id,
          player.tag
        ]
      );

    ticket =
      result.rows[0];

    await saveHistory(
      ticket.id,
      "created",
      player.id,
      player.tag
    );

    await player.send(
      `🎫 **Ticket #${ticket.id} Created**\n\n` +
      `Your message has been sent to Grand Mafia RP Support.\n` +
      `Please wait for an administrator.`
    );

    await notifyAdmins(
      ticket,
      message
    );

  }

  /* Save message */

  const files =
    await getAttachments(
      message
    );

  await saveMessage(
    ticket.id,
    player.id,
    player.tag,
    "player",
    message.content,
    files[0]
  );

  /* Forward to assigned admin */

  if (ticket.admin_id) {

    try {

      const admin =
        await client.users.fetch(
          ticket.admin_id
        );

      if (message.content) {

        await admin.send(
          `📩 **PLAYER — TICKET #${ticket.id}**\n\n` +
          message.content
        );
      }

      if (files.length) {

        await admin.send({
          files
        });
      }

    } catch (error) {

      console.error(
        "❌ Player message forwarding error:",
        error.message
      );
    }

  } else {

    await player.send(
      `⏳ Ticket #${ticket.id} is waiting for an administrator to claim it.`
    );
  }
}

/* ================= NOTIFY ADMINS ================= */

async function notifyAdmins(
  ticket,
  message
) {

  const guild =
    await client.guilds.fetch(
      GUILD_ID
    );

  const members =
    await guild.members.fetch();

  const admins =
    members.filter(
      member =>
        member.roles.cache.has(
          SUPPORT_ROLE_ID
        ) &&
        !member.user.bot
    );

  const embed =
    new EmbedBuilder()
      .setTitle(
        `🎫 NEW SUPPORT TICKET #${ticket.id}`
      )
      .setDescription(
        `👤 **Player:** ${ticket.player_tag}\n` +
        `🆔 **ID:** ${ticket.player_id}\n` +
        `📊 **Status:** Waiting\n\n` +
        `💬 **Message:**\n` +
        `${message.content || "[Attachment]"}`
      )
      .setTimestamp();

  const row =
    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()
          .setCustomId(
            `claim:${ticket.id}`
          )
          .setLabel("Claim")
          .setEmoji("🎫")
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId(
            `close:${ticket.id}`
          )
          .setLabel("Close")
          .setEmoji("🔴")
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            `hold:${ticket.id}`
          )
          .setLabel("Hold")
          .setEmoji("⏸️")
          .setStyle(
            ButtonStyle.Secondary
          )

      );

  for (
    const [, member]
    of admins
  ) {

    try {

      await member.user.send({
        embeds: [embed],
        components: [row]
      });

    } catch {}
  }

  await sendLog(
    `🎫 **TICKET CREATED**\n` +
    `Ticket: #${ticket.id}\n` +
    `Player: ${ticket.player_tag}\n` +
    `ID: ${ticket.player_id}`
  );
}

/* ================= ADMIN DM ================= */

async function handleAdminDM(message) {

  const admin =
    message.author;

  let ticketId =
    activeTickets.get(
      admin.id
    );

  if (!ticketId) {

    const result =
      await pool.query(
        `
        SELECT *
        FROM tickets
        WHERE admin_id = $1
        AND status = 'open'
        ORDER BY last_activity DESC
        LIMIT 1
        `,
        [admin.id]
      );

    if (result.rows[0]) {

      ticketId =
        result.rows[0].id;

      activeTickets.set(
        admin.id,
        ticketId
      );
    }
  }

  if (!ticketId) {

    await admin.send(
      "⚠️ You don't have an active ticket selected.\n\n" +
      "Use the **Claim** button on a ticket first."
    );

    return;
  }

  const ticket =
    await getTicket(
      ticketId
    );

  if (!ticket) {

    activeTickets.delete(
      admin.id
    );

    await admin.send(
      "❌ Ticket not found."
    );

    return;
  }

  if (ticket.status === "closed") {

    activeTickets.delete(
      admin.id
    );

    await admin.send(
      "🔴 This ticket is closed."
    );

    return;
  }

  if (ticket.status === "hold") {

    await admin.send(
      "⏸️ This ticket is currently on hold."
    );

    return;
  }

  if (
    ticket.admin_id !==
    admin.id
  ) {

    await admin.send(
      "❌ You are not assigned to this ticket."
    );

    return;
  }

  const player =
    await client.users.fetch(
      ticket.player_id
    );

  const files =
    await getAttachments(
      message
    );

  /*
   * IMPORTANT:
   * We intentionally do NOT include
   * the admin's name in the player's DM.
   */

  if (message.content) {

    await player.send(
      message.content
    );
  }

  if (files.length) {

    await player.send({
      files
    });
  }

  await saveMessage(
    ticket.id,
    admin.id,
    admin.tag,
    "admin",
    message.content,
    files[0]
  );

  await saveHistory(
    ticket.id,
    "admin_reply",
    admin.id,
    admin.tag
  );

  await updateAdminStats(
    admin.id,
    admin.tag,
    "messages"
  );

  await admin.send(
    "✅ Reply sent to player."
  );
}

/* ================= BUTTONS ================= */

client.on(
  Events.InteractionCreate,
  async interaction => {

    if (!interaction.isButton())
      return;

    try {

      const parts =
        interaction.customId.split(":");

      const action =
        parts[0];

      const ticketId =
        Number(parts[1]);

      const allowed =
        await isAdmin(
          interaction.user.id
        );

      if (!allowed) {

        await interaction.reply({
          content:
            "❌ Support staff only.",
          ephemeral: true
        });

        return;
      }

      const ticket =
        await getTicket(
          ticketId
        );

      if (!ticket) {

        await interaction.reply({
          content:
            "❌ Ticket not found.",
          ephemeral: true
        });

        return;
      }

      /* CLAIM */

      if (action === "claim") {

        if (ticket.admin_id) {

          await interaction.reply({
            content:
              `⚠️ Already claimed by ${ticket.admin_tag}.`,
            ephemeral: true
          });

          return;
        }

        await pool.query(
          `
          UPDATE tickets
          SET admin_id=$1,
              admin_tag=$2,
              status='open',
              claimed_at=CURRENT_TIMESTAMP,
              last_activity=CURRENT_TIMESTAMP
          WHERE id=$3
          `,
          [
            interaction.user.id,
            interaction.user.tag,
            ticketId
          ]
        );

        activeTickets.set(
          interaction.user.id,
          ticketId
        );

        await saveHistory(
          ticketId,
          "claimed",
          interaction.user.id,
          interaction.user.tag
        );

        await updateAdminStats(
          interaction.user.id,
          interaction.user.tag,
          "claimed"
        );

        try {

          const player =
            await client.users.fetch(
              ticket.player_id
            );

          await player.send(
            "👮 **A support administrator is now handling your request.**"
          );

        } catch {}

        await interaction.update({
          content:
            `🟢 **Ticket #${ticketId} claimed.**\n\n` +
            `Reply to this DM to message the player.`,
          embeds: [],
          components: []
        });

        await sendLog(
          `🎫 **TICKET CLAIMED**\n` +
          `Ticket: #${ticketId}\n` +
          `Admin: ${interaction.user.tag}\n` +
          `Player: ${ticket.player_tag}`
        );

        return;
      }

      /* CLOSE */

      if (action === "close") {

        await pool.query(
          `
          UPDATE tickets
          SET status='closed',
              closed_at=CURRENT_TIMESTAMP
          WHERE id=$1
          `,
          [ticketId]
        );

        activeTickets.delete(
          interaction.user.id
        );

        await saveHistory(
          ticketId,
          "closed",
          interaction.user.id,
          interaction.user.tag
        );

        await updateAdminStats(
          interaction.user.id,
          interaction.user.tag,
          "closed"
        );

        try {

          const player =
            await client.users.fetch(
              ticket.player_id
            );

          await player.send(
            `🔴 **Ticket #${ticketId} has been closed.**\n\n` +
            `Thank you for contacting Grand Mafia RP Support.`
          );

        } catch {}

        await interaction.update({
          content:
            `🔴 **Ticket #${ticketId} closed.**`,
          embeds: [],
          components: []
        });

        await sendLog(
          `🔴 **TICKET CLOSED**\n` +
          `Ticket: #${ticketId}\n` +
          `Closed by: ${interaction.user.tag}`
        );

        return;
      }

      /* HOLD */

      if (action === "hold") {

        await pool.query(
          `
          UPDATE tickets
          SET status='hold',
              hold_at=CURRENT_TIMESTAMP
          WHERE id=$1
          `,
          [ticketId]
        );

        await saveHistory(
          ticketId,
          "hold",
          interaction.user.id,
          interaction.user.tag
        );

        await interaction.update({
          content:
            `⏸️ **Ticket #${ticketId} placed on hold.**`,
          embeds: [],
          components: []
        });

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

/* ================= SLASH HANDLER ================= */

client.on(
  Events.InteractionCreate,
  async interaction => {

    if (
      !interaction.isChatInputCommand()
    ) return;

    try {

      const command =
        interaction.commandName;

      const admin =
        await isAdmin(
          interaction.user.id
        );

      /* SUPPORT */

      if (
        command === "support"
      ) {

        await interaction.reply({
          content:
            "🎫 **Grand Mafia RP Support**\n\n" +
            "Players can DM this bot to create a support ticket.\n" +
            "Support staff can claim tickets and reply directly.",
          ephemeral: true
        });

        return;
      }

      /* ADMIN COMMANDS */

      const adminCommands = [
        "tickets",
        "reopen",
        "hold",
        "unhold",
        "ticket-info",
        "ticket-history",
        "note",
        "notes",
        "transcript",
        "block",
        "unblock",
        "player-info",
        "admin-stats"
      ];

      if (
        adminCommands.includes(
          command
        ) &&
        !admin
      ) {

        await interaction.reply({
          content:
            "❌ Support staff only.",
          ephemeral: true
        });

        return;
      }

      /* TICKETS */

      if (
        command === "tickets"
      ) {

        const result =
          await pool.query(
            `
            SELECT *
            FROM tickets
            WHERE status != 'closed'
            ORDER BY id DESC
            LIMIT 20
            `
          );

        if (!result.rows.length) {

          await interaction.reply({
            content:
              "🎫 No active tickets.",
            ephemeral: true
          });

          return;
        }

        let text =
          "🎫 **ACTIVE TICKETS**\n\n";

        for (
          const ticket
          of result.rows
        ) {

          text +=
            `#${ticket.id} • ` +
            `${ticket.player_tag} • ` +
            `${ticket.status} • ` +
            `${ticket.admin_tag || "Unclaimed"}\n`;
        }

        await interaction.reply({
          content: text,
          ephemeral: true
        });

        return;
      }

      /* CLOSE */

      if (
        command === "close"
      ) {

        const ticket =
          await getTicketByPlayer(
            interaction.user.id
          );

        let target =
          ticket;

        if (
          admin
        ) {

          const result =
            await pool.query(
              `
              SELECT *
              FROM tickets
              WHERE admin_id=$1
              AND status != 'closed'
              ORDER BY id DESC
              LIMIT 1
              `,
              [interaction.user.id]
            );

          target =
            result.rows[0];
        }

        if (!target) {

          await interaction.reply({
            content:
              "❌ No active ticket found.",
            ephemeral: true
          });

          return;
        }

        await pool.query(
          `
          UPDATE tickets
          SET status='closed',
              closed_at=CURRENT_TIMESTAMP
          WHERE id=$1
          `,
          [target.id]
        );

        activeTickets.delete(
          interaction.user.id
        );

        await saveHistory(
          target.id,
          "closed",
          interaction.user.id,
          interaction.user.tag
        );

        try {

          const player =
            await client.users.fetch(
              target.player_id
            );

          await player.send(
            `🔴 **Ticket #${target.id} closed.**`
          );

        } catch {}

        await interaction.reply({
          content:
            `🔴 Ticket #${target.id} closed.`,
          ephemeral: true
        });

        return;
      }

      /* HOLD */

      if (
        command === "hold"
      ) {

        const result =
          await pool.query(
            `
            SELECT *
            FROM tickets
            WHERE admin_id=$1
            AND status='open'
            ORDER BY id DESC
            LIMIT 1
            `,
            [interaction.user.id]
          );

        const ticket =
          result.rows[0];

        if (!ticket) {

          await interaction.reply({
            content:
              "❌ You don't have an active ticket.",
            ephemeral: true
          });

          return;
        }

        await pool.query(
          `
          UPDATE tickets
          SET status='hold',
              hold_at=CURRENT_TIMESTAMP
          WHERE id=$1
          `,
          [ticket.id]
        );

        await saveHistory(
          ticket.id,
          "hold",
          interaction.user.id,
          interaction.user.tag
        );

        await interaction.reply({
          content:
            `⏸️ Ticket #${ticket.id} placed on hold.`,
          ephemeral: true
        });

        return;
      }

      /* UNHOLD */

      if (
        command === "unhold"
      ) {

        const result =
          await pool.query(
            `
            SELECT *
            FROM tickets
            WHERE admin_id=$1
            AND status='hold'
            ORDER BY id DESC
            LIMIT 1
            `,
            [interaction.user.id]
          );

        const ticket =
          result.rows[0];

        if (!ticket) {

          await interaction.reply({
            content:
              "❌ No ticket on hold.",
            ephemeral: true
          });

          return;
        }

        await pool.query(
          `
          UPDATE tickets
          SET status='open',
              last_activity=CURRENT_TIMESTAMP
          WHERE id=$1
          `,
          [ticket.id]
        );

        await saveHistory(
          ticket.id,
          "unhold",
          interaction.user.id,
          interaction.user.tag
        );

        activeTickets.set(
          interaction.user.id,
          ticket.id
        );

        await interaction.reply({
          content:
            `▶️ Ticket #${ticket.id} resumed.`,
          ephemeral: true
        });

        return;
      }

      /* TICKET INFO */

      if (
        command === "ticket-info"
      ) {

        const ticket =
          await getTicketByPlayer(
            interaction.user.id
          );

        if (!ticket) {

          await interaction.reply({
            content:
              "❌ No active ticket.",
            ephemeral: true
          });

          return;
        }

        await interaction.reply({
          content:
            `🎫 **Ticket #${ticket.id}**\n\n` +
            `👤 Player: ${ticket.player_tag}\n` +
            `👮 Admin: ${ticket.admin_tag || "Unclaimed"}\n` +
            `📊 Status: ${ticket.status}\n` +
            `🏷️ Category: ${ticket.category}\n` +
            `🚦 Priority: ${ticket.priority}\n` +
            `🕐 Created: ${ticket.created_at}\n` +
            `🕐 Last activity: ${ticket.last_activity}`,
          ephemeral: true
        });

        return;
      }

      /* HISTORY */

      if (
        command === "ticket-history"
      ) {

        const ticket =
          await getTicketByPlayer(
            interaction.user.id
          );

        if (!ticket) {

          await interaction.reply({
            content:
              "❌ No active ticket.",
            ephemeral: true
          });

          return;
        }

        const result =
          await pool.query(
            `
            SELECT *
            FROM ticket_history
            WHERE ticket_id=$1
            ORDER BY id DESC
            LIMIT 20
            `,
            [ticket.id]
          );

        let text =
          `📋 **Ticket #${ticket.id} History**\n\n`;

        for (
          const item
          of result.rows
        ) {

          text +=
            `• ${item.action} — ` +
            `${item.actor_tag || "System"}\n`;
        }

        await interaction.reply({
          content: text,
          ephemeral: true
        });

        return;
      }

      /* NOTE */

      if (
        command === "note"
      ) {

        const text =
          interaction.options.getString(
            "text"
          );

        const result =
          await pool.query(
            `
            SELECT *
            FROM tickets
            WHERE admin_id=$1
            AND status != 'closed'
            ORDER BY id DESC
            LIMIT 1
            `,
            [interaction.user.id]
          );

        const ticket =
          result.rows[0];

        if (!ticket) {

          await interaction.reply({
            content:
              "❌ No active ticket.",
            ephemeral: true
          });

          return;
        }

        await pool.query(
          `
          INSERT INTO ticket_notes
          (ticket_id,admin_id,admin_tag,note)
          VALUES ($1,$2,$3,$4)
          `,
          [
            ticket.id,
            interaction.user.id,
            interaction.user.tag,
            text
          ]
        );

        await saveHistory(
          ticket.id,
          "internal_note",
          interaction.user.id,
          interaction.user.tag,
          text
        );

        await interaction.reply({
          content:
            "📝 Internal note saved.",
          ephemeral: true
        });

        return;
      }

      /* NOTES */

      if (
        command === "notes"
      ) {

        const result =
          await pool.query(
            `
            SELECT *
            FROM tickets
            WHERE admin_id=$1
            AND status != 'closed'
            ORDER BY id DESC
            LIMIT 1
            `,
            [interaction.user.id]
          );

        const ticket =
          result.rows[0];

        if (!ticket) {

          await interaction.reply({
            content:
              "❌ No active ticket.",
            ephemeral: true
          });

          return;
        }

        const notes =
          await pool.query(
            `
            SELECT *
            FROM ticket_notes
            WHERE ticket_id=$1
            ORDER BY id DESC
            LIMIT 20
            `,
            [ticket.id]
          );

        let text =
          `📝 **Notes — Ticket #${ticket.id}**\n\n`;

        if (!notes.rows.length) {
          text += "No notes.";
        }

        for (
          const note
          of notes.rows
        ) {

          text +=
            `• ${note.admin_tag}: ` +
            `${note.note}\n`;
        }

        await interaction.reply({
          content: text,
          ephemeral: true
        });

        return;
      }

      /* TRANSCRIPT */

      if (
        command === "transcript"
      ) {

        const result =
          await pool.query(
            `
            SELECT *
            FROM tickets
            WHERE admin_id=$1
            OR player_id=$1
            ORDER BY id DESC
            LIMIT 1
            `,
            [interaction.user.id]
          );

        const ticket =
          result.rows[0];

        if (!ticket) {

          await interaction.reply({
            content:
              "❌ Ticket not found.",
            ephemeral: true
          });

          return;
        }

        const messages =
          await pool.query(
            `
            SELECT *
            FROM ticket_messages
            WHERE ticket_id=$1
            ORDER BY id ASC
            `,
            [ticket.id]
          );

        let transcript =
          `GRAND MAFIA RP SUPPORT\n` +
          `TICKET #${ticket.id}\n` +
          `PLAYER: ${ticket.player_tag}\n` +
          `STATUS: ${ticket.status}\n\n`;

        for (
          const msg
          of messages.rows
        ) {

          transcript +=
            `[${msg.created_at}] ` +
            `${msg.sender_type}: ` +
            `${msg.content || "[Attachment]"}\n`;
        }

        if (
          transcript.length >
          1900
        ) {

          transcript =
            transcript.slice(
              0,
              1890
            ) +
            "\n...";
        }

        await interaction.reply({
          content:
            "```text\n" +
            transcript +
            "\n```",
          ephemeral: true
        });

        return;
      }

      /* BLOCK */

      if (
        command === "block"
      ) {

        const player =
          interaction.options.getString(
            "player"
          );

        const reason =
          interaction.options.getString(
            "reason"
          ) ||
          "No reason provided";

        await pool.query(
          `
          INSERT INTO blocked_players
          (player_id,player_tag,blocked_by,reason)
          VALUES ($1,$2,$3,$4)

          ON CONFLICT (player_id)
          DO UPDATE SET
          blocked_by=$3,
          reason=$4
          `,
          [
            player,
            player,
            interaction.user.tag,
            reason
          ]
        );

        await interaction.reply({
          content:
            `🚫 Player ${player} blocked from support.`,
          ephemeral: true
        });

        return;
      }

      /* UNBLOCK */

      if (
        command === "unblock"
      ) {

        const player =
          interaction.options.getString(
            "player"
          );

        await pool.query(
          `
          DELETE FROM blocked_players
          WHERE player_id=$1
          `,
          [player]
        );

        await interaction.reply({
          content:
            `🔓 Player ${player} unblocked.`,
          ephemeral: true
        });

        return;
      }

      /* PLAYER INFO */

      if (
        command === "player-info"
      ) {

        const player =
          interaction.options.getString(
            "player"
          );

        const result =
          await pool.query(
            `
            SELECT *
            FROM tickets
            WHERE player_id=$1
            ORDER BY id DESC
            `,
            [player]
          );

        if (!result.rows.length) {

          await interaction.reply({
            content:
              "❌ No ticket history found.",
            ephemeral: true
          });

          return;
        }

        const total =
          result.rows.length;

        const closed =
          result.rows.filter(
            t => t.status === "closed"
          ).length;

        await interaction.reply({
          content:
            `👤 **Player Information**\n\n` +
            `🆔 ID: ${player}\n` +
            `🎫 Total tickets: ${total}\n` +
            `🔴 Closed tickets: ${closed}`,
          ephemeral: true
        });

        return;
      }

      /* ADMIN STATS */

      if (
        command === "admin-stats"
      ) {

        const result =
          await pool.query(
            `
            SELECT *
            FROM admin_stats
            WHERE admin_id=$1
            `,
            [interaction.user.id]
          );

        const stats =
          result.rows[0];

        if (!stats) {

          await interaction.reply({
            content:
              "📊 No statistics recorded yet.",
            ephemeral: true
          });

          return;
        }

        await interaction.reply({
          content:
            `📊 **Your Support Statistics**\n\n` +
            `🎫 Claimed: ${stats.claimed}\n` +
            `🔴 Closed: ${stats.closed}\n` +
            `💬 Messages: ${stats.messages}\n` +
            `🔄 Transfers: ${stats.transferred}`,
          ephemeral: true
        });

        return;
      }

    } catch (error) {

      console.error(
        "❌ Command error:",
        error
      );

      if (
        !interaction.replied &&
        !interaction.deferred
      ) {

        await interaction.reply({
          content:
            "❌ An error occurred.",
          ephemeral: true
        });
      }
    }
  }
);

/* ================= AUTO INACTIVITY CLOSE ================= */

setInterval(
  async () => {

    try {

      const result =
        await pool.query(
          `
          SELECT *
          FROM tickets
          WHERE status IN ('open','hold')
          AND last_activity <
          CURRENT_TIMESTAMP -
          INTERVAL '${INACTIVITY_HOURS} hours'
          `
        );

      for (
        const ticket
        of result.rows
      ) {

        await pool.query(
          `
          UPDATE tickets
          SET status='closed',
              closed_at=CURRENT_TIMESTAMP
          WHERE id=$1
          `,
          [ticket.id]
        );

        await saveHistory(
          ticket.id,
          "automatic_inactivity_close",
          "SYSTEM",
          "Automatic System",
          `${INACTIVITY_HOURS} hours inactive`
        );

        activeTickets.delete(
          ticket.admin_id
        );

        try {

          const player =
            await client.users.fetch(
              ticket.player_id
            );

          await player.send(
            `⏰ **Ticket #${ticket.id} automatically closed.**\n\n` +
            `Reason: No activity for ${INACTIVITY_HOURS} hours.\n\n` +
            `DM the bot again if you need further help.`
          );

        } catch {}

        await sendLog(
          `⏰ **AUTOMATIC TICKET CLOSE**\n` +
          `Ticket: #${ticket.id}\n` +
          `Player: ${ticket.player_tag}\n` +
          `Reason: ${INACTIVITY_HOURS} hours inactivity`
        );
      }

    } catch (error) {

      console.error(
        "❌ Inactivity system error:",
        error.message
      );
    }

  },
  10 * 60 * 1000
);

/* ================= LOGIN ================= */

console.log(
  "🔄 Connecting to Discord..."
);

client.login(TOKEN)
  .then(() => {

    console.log(
      "🔐 Discord login successful"
    );

  })
  .catch(error => {

    console.error(
      "❌ Discord login failed:",
      error
    );

    process.exit(1);
  });
