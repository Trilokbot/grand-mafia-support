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

const { Pool } = require("pg");
const express = require("express");

// ================= CONFIG =================

const TOKEN = process.env.DISCORD_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

const GUILD_ID = "1493700265499689154";
const SUPPORT_ROLE_ID = "1542498406981959801";
const LOG_CHANNEL_ID = "1542500573000106024";

const INACTIVITY_HOURS = 24;

// ================= CHECK ENV =================

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN is missing");
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL is missing");
  process.exit(1);
}

// ================= WEB SERVER =================

const app = express();

app.get("/", (req, res) => {
  res.send("Grand Mafia RP Support Bot Online");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// ================= DATABASE =================

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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      claimed_at TIMESTAMP,
      closed_at TIMESTAMP,
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
      messages INTEGER DEFAULT 0
    );
  `);

  console.log("✅ PostgreSQL database ready");
}

// ================= DISCORD =================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ================= HELPERS =================

async function getTicket(playerId) {
  const result = await pool.query(
    `SELECT * FROM tickets
     WHERE player_id = $1
     AND status != 'closed'
     LIMIT 1`,
    [playerId]
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
    [ticketId, action, actorId, actorTag, details]
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
    `INSERT INTO ticket_messages
    (ticket_id,sender_id,sender_tag,sender_type,content,attachment_url)
    VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      ticketId,
      senderId,
      senderTag,
      senderType,
      content || "",
      attachment
    ]
  );

  await pool.query(
    `UPDATE tickets
     SET last_activity = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [ticketId]
  );
}

async function logMessage(text) {
  try {
    const channel =
      await client.channels.fetch(LOG_CHANNEL_ID);

    if (channel && channel.isTextBased()) {
      await channel.send(text);
    }
  } catch (error) {
    console.error("Log error:", error.message);
  }
}

async function isSupport(member) {
  return member.roles.cache.has(SUPPORT_ROLE_ID);
}

// ================= READY =================

client.once(Events.ClientReady, async () => {
  console.log("================================");
  console.log(`✅ BOT ONLINE: ${client.user.tag}`);
  console.log("================================");

  try {
    await setupDatabase();
  } catch (error) {
    console.error("❌ Database error:", error);
  }
});

// ================= DM SYSTEM =================

client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  if (message.guild) return;

  try {
    const user = message.author;

    const guild =
      await client.guilds.fetch(GUILD_ID);

    let admin = false;

    try {
      const member =
        await guild.members.fetch(user.id);

      admin = await isSupport(member);
    } catch {}

    // ================= ADMIN DM =================

    if (admin) {
      const result = await pool.query(
        `SELECT * FROM tickets
         WHERE admin_id = $1
         AND status = 'open'
         ORDER BY id DESC
         LIMIT 1`,
        [user.id]
      );

      const ticket = result.rows[0];

      if (!ticket) {
        await user.send(
          "❌ You don't have a claimed ticket."
        );
        return;
      }

      const player =
        await client.users.fetch(ticket.player_id);

      if (message.content) {
        await player.send(message.content);
      }

      const attachments = [];

      for (
        const file
        of message.attachments.values()
      ) {
        attachments.push(file.url);
      }

      if (attachments.length) {
        await player.send({
          files: attachments
        });
      }

      await saveMessage(
        ticket.id,
        user.id,
        user.tag,
        "admin",
        message.content,
        attachments[0] || null
      );

      await pool.query(
        `INSERT INTO admin_stats
        (admin_id,admin_tag,messages)
        VALUES ($1,$2,1)
        ON CONFLICT (admin_id)
        DO UPDATE SET
        messages = admin_stats.messages + 1,
        admin_tag = $2`,
        [user.id, user.tag]
      );

      await message.react("✅");

      await logMessage(
        `💬 **ADMIN REPLY**\n` +
        `🎫 Ticket #${ticket.id}\n` +
        `👮 Admin: ${user.tag}\n` +
        `👤 Player: ${ticket.player_tag}`
      );

      return;
    }

    // ================= BLOCK CHECK =================

    const blocked =
      await pool.query(
        `SELECT * FROM blocked_players
         WHERE player_id = $1`,
        [user.id]
      );

    if (blocked.rows.length) {
      await user.send(
        "🚫 You are blocked from using support."
      );
      return;
    }

    // ================= EXISTING TICKET =================

    let ticket =
      await getTicket(user.id);

    if (ticket) {
      if (ticket.admin_id) {
        const adminUser =
          await client.users.fetch(
            ticket.admin_id
          );

        if (message.content) {
          await adminUser.send(
            `📩 **PLAYER MESSAGE — TICKET #${ticket.id}**\n\n` +
            message.content
          );
        }

        const attachments = [];

        for (
          const file
          of message.attachments.values()
        ) {
          attachments.push(file.url);
        }

        if (attachments.length) {
          await adminUser.send({
            files: attachments
          });
        }

        await saveMessage(
          ticket.id,
          user.id,
          user.tag,
          "player",
          message.content,
          attachments[0] || null
        );
      } else {
        await user.send(
          `⏳ Your ticket #${ticket.id} is waiting for an administrator.`
        );
      }

      return;
    }

    // ================= CREATE TICKET =================

    const result =
      await pool.query(
        `INSERT INTO tickets
        (player_id,player_tag)
        VALUES ($1,$2)
        RETURNING *`,
        [user.id, user.tag]
      );

    ticket = result.rows[0];

    const attachments = [];

    for (
      const file
      of message.attachments.values()
    ) {
      attachments.push(file.url);
    }

    await saveMessage(
      ticket.id,
      user.id,
      user.tag,
      "player",
      message.content,
      attachments[0] || null
    );

    await addHistory(
      ticket.id,
      "created",
      user.id,
      user.tag,
      message.content
    );

    // ================= SEND TO ADMINS =================

    const members =
      await guild.members.fetch();

    const admins =
      members.filter(member =>
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
          `👤 Player: **${user.tag}**\n` +
          `🆔 ID: **${user.id}**\n\n` +
          `💬 Message:\n${message.content || "[Attachment]"}`
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
              ButtonStyle.Primary
            ),

          new ButtonBuilder()
            .setCustomId(
              `block:${ticket.id}`
            )
            .setLabel("Block")
            .setEmoji("🚫")
            .setStyle(
              ButtonStyle.Danger
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

    await user.send(
      `🎫 **Ticket #${ticket.id} created!**\n\n` +
      `Your message has been sent to the Grand Mafia RP Support Team.\n` +
      `Please wait for an administrator to respond.`
    );

    await logMessage(
      `🎫 **TICKET CREATED**\n` +
      `Ticket: #${ticket.id}\n` +
      `Player: ${user.tag}\n` +
      `ID: ${user.id}`
    );

  } catch (error) {
    console.error("❌ DM error:", error);
  }
});

// ================= BUTTONS =================

client.on(
  Events.InteractionCreate,
  async interaction => {

    if (!interaction.isButton()) return;

    try {

      const [action, id] =
        interaction.customId.split(":");

      const ticketId =
        Number(id);

      const result =
        await pool.query(
          `SELECT * FROM tickets
           WHERE id = $1`,
          [ticketId]
        );

      const ticket =
        result.rows[0];

      if (!ticket) {
        return interaction.reply({
          content: "❌ Ticket not found.",
          ephemeral: true
        });
      }

      const guild =
        await client.guilds.fetch(GUILD_ID);

      const member =
        await guild.members.fetch(
          interaction.user.id
        );

      if (!member.roles.cache.has(
        SUPPORT_ROLE_ID
      )) {
        return interaction.reply({
          content:
            "❌ Support staff only.",
          ephemeral: true
        });
      }

      // ================= CLAIM =================

      if (action === "claim") {

        if (ticket.admin_id) {
          return interaction.reply({
            content:
              `⚠️ Already claimed by ${ticket.admin_tag}.`,
            ephemeral: true
          });
        }

        await pool.query(
          `UPDATE tickets
           SET admin_id=$1,
               admin_tag=$2,
               claimed_at=CURRENT_TIMESTAMP
           WHERE id=$3`,
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

        await pool.query(
          `INSERT INTO admin_stats
          (admin_id,admin_tag,claimed)
          VALUES ($1,$2,1)
          ON CONFLICT (admin_id)
          DO UPDATE SET
          claimed=admin_stats.claimed+1`,
          [
            interaction.user.id,
            interaction.user.tag
          ]
        );

        await interaction.update({
          content:
            `🟢 **Ticket #${ticketId} claimed.**\n\n` +
            `You can now reply to this DM to message the player.`,
          embeds: [],
          components: []
        });

        const player =
          await client.users.fetch(
            ticket.player_id
          );

        await player.send(
          "👮 **A support administrator is now handling your ticket.**"
        );

        await logMessage(
          `🎫 **TICKET CLAIMED**\n` +
          `Ticket: #${ticketId}\n` +
          `Admin: ${interaction.user.tag}\n` +
          `Player: ${ticket.player_tag}`
        );

        return;
      }

      // ================= BLOCK =================

      if (action === "block") {

        await pool.query(
          `INSERT INTO blocked_players
          (player_id,player_tag,blocked_by,reason)
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
            `🚫 ${ticket.player_tag} has been blocked.`,
          ephemeral: true
        });

        return;
      }

    } catch (error) {
      console.error("❌ Button error:", error);

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

// ================= LOGIN =================

console.log("🔄 Connecting to Discord...");

client.login(TOKEN)
  .then(() => {
    console.log("🔐 Discord login successful!");
  })
  .catch(error => {
    console.error(
      "❌ Discord login failed:",
      error
    );
    process.exit(1);
  });
