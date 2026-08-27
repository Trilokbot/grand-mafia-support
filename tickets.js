const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const GUILD_ID = "1493700265499689154";
const SUPPORT_ROLE_ID = "1542498406981959801";
const LOG_CHANNEL_ID = "1542500573000106024";

const activeAdmins = new Map();

async function isSupportAdmin(client, userId) {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(userId);

    return member.roles.cache.has(SUPPORT_ROLE_ID);
  } catch {
    return false;
  }
}

async function logTicket(client, text) {
  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID);

    if (channel && channel.isTextBased()) {
      await channel.send(text);
    }
  } catch (error) {
    console.error("Ticket log error:", error.message);
  }
}

async function getTicket(pool, playerId) {
  const result = await pool.query(
    `SELECT * FROM tickets
     WHERE player_id = $1
     AND status != 'closed'
     LIMIT 1`,
    [playerId]
  );

  return result.rows[0] || null;
}

async function createTicket(pool, player) {
  const result = await pool.query(
    `INSERT INTO tickets
    (player_id, player_tag)
    VALUES ($1, $2)
    RETURNING *`,
    [player.id, player.tag]
  );

  return result.rows[0];
}

async function saveMessage(
  pool,
  ticketId,
  senderId,
  senderTag,
  senderType,
  content,
  attachment
) {
  await pool.query(
    `INSERT INTO ticket_messages
    (ticket_id, sender_id, sender_tag, sender_type,
     content, attachment_url)
    VALUES ($1,$2,$3,$4,$5,$6)`,
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
    `UPDATE tickets
     SET last_activity = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [ticketId]
  );
}

async function history(
  pool,
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

async function sendTicketToAdmins(client, pool, ticket, player, message) {
  const guild = await client.guilds.fetch(GUILD_ID);
  const members = await guild.members.fetch();

  const admins = members.filter(member =>
    member.roles.cache.has(SUPPORT_ROLE_ID) &&
    !member.user.bot
  );

  const embed = new EmbedBuilder()
    .setTitle(`🎫 NEW SUPPORT TICKET #${ticket.id}`)
    .setDescription(
      `👤 **Player:** ${player.tag}\n` +
      `🆔 **ID:** ${player.id}\n` +
      `📊 **Status:** Waiting\n\n` +
      `💬 **Message:**\n${message.content || "[Attachment]"}`
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_claim_${ticket.id}`)
      .setLabel("Claim")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`ticket_close_${ticket.id}`)
      .setLabel("Close")
      .setEmoji("🔴")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId(`ticket_hold_${ticket.id}`)
      .setLabel("Hold")
      .setEmoji("⏸️")
      .setStyle(ButtonStyle.Secondary)
  );

  for (const [, member] of admins) {
    try {
      await member.user.send({
        embeds: [embed],
        components: [row]
      });
    } catch {}
  }

  await logTicket(
    client,
    `🎫 **TICKET CREATED**\n` +
    `Ticket: #${ticket.id}\n` +
    `Player: ${player.tag}\n` +
    `ID: ${player.id}`
  );
}

async function handlePlayerDM(client, pool, message) {
  const player = message.author;

  const blocked = await pool.query(
    `SELECT * FROM blocked_players
     WHERE player_id = $1`,
    [player.id]
  );

  if (blocked.rows.length) {
    await player.send(
      "🚫 You are currently blocked from Grand Mafia RP Support."
    );
    return;
  }

  let ticket = await getTicket(pool, player.id);

  if (!ticket) {
    ticket = await createTicket(pool, player);

    await history(
      pool,
      ticket.id,
      "created",
      player.id,
      player.tag
    );

    await player.send(
      `🎫 **Ticket #${ticket.id} Created**\n\n` +
      `Your request has been sent to the support team.\n` +
      `Please wait for an administrator to claim your ticket.`
    );

    await sendTicketToAdmins(
      client,
      pool,
      ticket,
      player,
      message
    );
  }

  const files = [];

  for (const attachment of message.attachments.values()) {
    files.push(attachment.url);
  }

  await saveMessage(
    pool,
    ticket.id,
    player.id,
    player.tag,
    "player",
    message.content,
    files[0]
  );

  if (ticket.admin_id) {
    try {
      const admin = await client.users.fetch(ticket.admin_id);

      if (message.content) {
        await admin.send(
          `📩 **PLAYER MESSAGE — TICKET #${ticket.id}**\n\n` +
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
        "Could not forward player message:",
        error.message
      );
    }
  }
}

async function handleAdminDM(client, pool, message) {
  const admin = message.author;

  const allowed = await isSupportAdmin(
    client,
    admin.id
  );

  if (!allowed) return false;

  const ticketId = activeAdmins.get(admin.id);

  if (!ticketId) {
    await admin.send(
      "⚠️ You don't have an active ticket selected.\n\n" +
      "Use the **Claim** button on a ticket first."
    );

    return true;
  }

  const result = await pool.query(
    `SELECT * FROM tickets
     WHERE id = $1`,
    [ticketId]
  );

  const ticket = result.rows[0];

  if (!ticket) {
    activeAdmins.delete(admin.id);

    await admin.send(
      "❌ Ticket not found."
    );

    return true;
  }

  if (ticket.status === "closed") {
    activeAdmins.delete(admin.id);

    await admin.send(
      "🔴 This ticket is closed."
    );

    return true;
  }

  const player = await client.users.fetch(
    ticket.player_id
  );

  const files = [];

  for (const attachment of message.attachments.values()) {
    files.push(attachment.url);
  }

  /*
   * IMPORTANT:
   * The player's DM does NOT contain the admin's
   * Discord username.
   */

  if (message.content) {
    await player.send(message.content);
  }

  if (files.length) {
    await player.send({
      files
    });
  }

  await saveMessage(
    pool,
    ticket.id,
    admin.id,
    admin.tag,
    "admin",
    message.content,
    files[0]
  );

  await history(
    pool,
    ticket.id,
    "admin_reply",
    admin.id,
    admin.tag
  );

  await pool.query(
    `INSERT INTO admin_stats
    (admin_id, admin_tag, messages)
    VALUES ($1,$2,1)
    ON CONFLICT (admin_id)
    DO UPDATE SET
    messages = admin_stats.messages + 1,
    admin_tag = $2`,
    [admin.id, admin.tag]
  );

  await admin.send("✅ Message sent to player.");

  return true;
}

async function handleButton(client, pool, interaction) {
  if (!interaction.isButton()) return;

  const parts = interaction.customId.split("_");

  if (parts[0] !== "ticket") return;

  const action = parts[1];
  const ticketId = Number(parts[2]);

  const allowed = await isSupportAdmin(
    client,
    interaction.user.id
  );

  if (!allowed) {
    await interaction.reply({
      content: "❌ Support staff only.",
      ephemeral: true
    });
    return;
  }

  const result = await pool.query(
    `SELECT * FROM tickets
     WHERE id = $1`,
    [ticketId]
  );

  const ticket = result.rows[0];

  if (!ticket) {
    await interaction.reply({
      content: "❌ Ticket not found.",
      ephemeral: true
    });
    return;
  }

  // ================= CLAIM =================

  if (action === "claim") {
    if (ticket.admin_id) {
      await interaction.reply({
        content:
          `⚠️ This ticket is already claimed by ${ticket.admin_tag}.`,
        ephemeral: true
      });
      return;
    }

    await pool.query(
      `UPDATE tickets
       SET admin_id=$1,
           admin_tag=$2,
           claimed_at=CURRENT_TIMESTAMP,
           status='open'
       WHERE id=$3`,
      [
        interaction.user.id,
        interaction.user.tag,
        ticketId
      ]
    );

    activeAdmins.set(
      interaction.user.id,
      ticketId
    );

    await history(
      pool,
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
      claimed=admin_stats.claimed+1,
      admin_tag=$2`,
      [
        interaction.user.id,
        interaction.user.tag
      ]
    );

    const player = await client.users.fetch(
      ticket.player_id
    );

    await player.send(
      "👮 **Your support request is now being handled.**"
    );

    await interaction.update({
      content:
        `🟢 **Ticket #${ticketId} claimed.**\n\n` +
        `You can reply to this DM to message the player.`,
      embeds: [],
      components: []
    });

    await logTicket(
      client,
      `🎫 **TICKET CLAIMED**\n` +
      `Ticket: #${ticketId}\n` +
      `Admin: ${interaction.user.tag}\n` +
      `Player: ${ticket.player_tag}`
    );

    return;
  }

  // ================= CLOSE =================

  if (action === "close") {
    await pool.query(
      `UPDATE tickets
       SET status='closed',
           closed_at=CURRENT_TIMESTAMP
       WHERE id=$1`,
      [ticketId]
    );

    activeAdmins.delete(
      interaction.user.id
    );

    await history(
      pool,
      ticketId,
      "closed",
      interaction.user.id,
      interaction.user.tag
    );

    try {
      const player = await client.users.fetch(
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

    await logTicket(
      client,
      `🔴 **TICKET CLOSED**\n` +
      `Ticket: #${ticketId}\n` +
      `By: ${interaction.user.tag}`
    );

    return;
  }

  // ================= HOLD =================

  if (action === "hold") {
    if (!ticket.admin_id) {
      await interaction.reply({
        content:
          "❌ Claim the ticket first.",
        ephemeral: true
      });
      return;
    }

    await pool.query(
      `UPDATE tickets
       SET status='hold'
       WHERE id=$1`,
      [ticketId]
    );

    await history(
      pool,
      ticketId,
      "hold",
      interaction.user.id,
      interaction.user.tag
    );

    await interaction.update({
      content:
        `⏸️ **Ticket #${ticketId} is on hold.**`,
      embeds: [],
      components: []
    });

    return;
  }
}

function setupTicketSystem(client, pool) {

  client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;
    if (message.guild) return;

    try {
      const isAdmin = await isSupportAdmin(
        client,
        message.author.id
      );

      if (isAdmin) {
        await handleAdminDM(
          client,
          pool,
          message
        );
      } else {
        await handlePlayerDM(
          client,
          pool,
          message
        );
      }
    } catch (error) {
      console.error(
        "Ticket system error:",
        error
      );
    }
  });

  client.on(
    Events.InteractionCreate,
    async interaction => {
      try {
        await handleButton(
          client,
          pool,
          interaction
        );
      } catch (error) {
        console.error(
          "Ticket button error:",
          error
        );
      }
    }
  );

  console.log("🎫 DM Ticket System loaded");
}

module.exports = {
  setupTicketSystem
};
