const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events
} = require("discord.js");

const express = require("express");

// ==========================================
// CONFIGURATION
// ==========================================

const TOKEN = process.env.DISCORD_TOKEN;

const SUPPORT_ROLE_ID = "1542498406981959801";
const LOG_CHANNEL_ID = "1542500573000106024";
const GUILD_ID = "1493700265499689154";

// ==========================================
// TOKEN CHECK
// ==========================================

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN is missing!");
  process.exit(1);
}

// ==========================================
// RENDER WEB SERVER
// ==========================================

const app = express();

app.get("/", (req, res) => {
  res.send("Grand Mafia RP Support Bot is Online!");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// ==========================================
// DISCORD CLIENT
// ==========================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ==========================================
// TICKET STORAGE
// ==========================================

// playerId -> ticket data
const tickets = new Map();

// ==========================================
// BOT READY
// ==========================================

client.once(Events.ClientReady, () => {

  console.log("================================");
  console.log(`✅ BOT ONLINE: ${client.user.tag}`);
  console.log(`🏠 SERVER: ${GUILD_ID}`);
  console.log(`👮 SUPPORT ROLE: ${SUPPORT_ROLE_ID}`);
  console.log("================================");

});

// ==========================================
// DISCORD ERRORS
// ==========================================

client.on("error", error => {
  console.error("❌ Discord error:", error);
});

client.on("shardError", error => {
  console.error("❌ Discord shard error:", error);
});

// ==========================================
// MAIN DM SYSTEM
// ==========================================

client.on(Events.MessageCreate, async message => {

  try {

    // Ignore bots
    if (message.author.bot) return;

    // Ignore server messages
    if (message.guild) return;

    const sender = message.author;

    // ======================================
    // CHECK WHETHER SENDER IS SUPPORT ADMIN
    // ======================================

    let isSupportAdmin = false;

    try {

      const guild =
        await client.guilds.fetch(GUILD_ID);

      const member =
        await guild.members.fetch(sender.id);

      isSupportAdmin =
        member.roles.cache.has(SUPPORT_ROLE_ID);

    } catch {

      isSupportAdmin = false;

    }

    // ======================================
    // ADMIN MESSAGE
    // ======================================

    if (isSupportAdmin) {

      let ticket = null;

      // Find ticket owned by this admin
      for (const [playerId, data] of tickets.entries()) {

        if (data.adminId === sender.id) {

          ticket = {
            playerId,
            ...data
          };

          break;

        }

      }

      // Admin has no active ticket
      if (!ticket) {

        await sender.send(
          "⚠️ You don't currently have a claimed support ticket."
        );

        return;

      }

      // Get player
      const player =
        await client.users.fetch(ticket.playerId);

      // ======================================
      // SEND ADMIN MESSAGE TO PLAYER
      // ======================================

      await player.send(message.content);

      // Confirm to admin
      await message.react("✅");

      console.log(
        `📤 ${sender.tag} → ${player.tag}: ${message.content}`
      );

      // Log message
      try {

        const logChannel =
          await client.channels.fetch(LOG_CHANNEL_ID);

        await logChannel.send(
          `💬 **SUPPORT MESSAGE**\n\n` +
          `👮 Admin: ${sender.tag}\n` +
          `👤 Player: ${player.tag}\n` +
          `📝 Message: ${message.content}`
        );

      } catch (error) {

        console.error(
          "❌ Could not send log:",
          error
        );

      }

      return;

    }

    // ======================================
    // PLAYER MESSAGE
    // ======================================

    const player = sender;

    console.log(
      `📩 Player DM received: ${player.tag}`
    );

    // ======================================
    // EXISTING TICKET
    // ======================================

    if (tickets.has(player.id)) {

      const ticket =
        tickets.get(player.id);

      try {

        const admin =
          await client.users.fetch(ticket.adminId);

        await admin.send(
          `📩 **PLAYER MESSAGE**\n\n` +
          `👤 Player: ${player.tag}\n` +
          `🆔 User ID: ${player.id}\n\n` +
          `💬 ${message.content}`
        );

        console.log(
          `📤 ${player.tag} → ${admin.tag}`
        );

      } catch (error) {

        console.error(
          "❌ Could not forward message:",
          error
        );

        await player.send(
          "⚠️ Your support administrator is currently unavailable."
        );

      }

      return;

    }

    // ======================================
    // GET SERVER
    // ======================================

    let guild;

    try {

      guild =
        await client.guilds.fetch(GUILD_ID);

    } catch (error) {

      console.error(
        "❌ Cannot access server:",
        error
      );

      await player.send(
        "⚠️ Support system is currently unavailable."
      );

      return;

    }

    // ======================================
    // GET MEMBERS
    // ======================================

    let members;

    try {

      members =
        await guild.members.fetch();

    } catch (error) {

      console.error(
        "❌ Cannot fetch server members:",
        error
      );

      await player.send(
        "⚠️ Support system is currently unavailable."
      );

      return;

    }

    // ======================================
    // FIND SUPPORT TEAM
    // ======================================

    const admins =
      members.filter(member =>
        member.roles.cache.has(SUPPORT_ROLE_ID) &&
        !member.user.bot
      );

    console.log(
      `👮 Support admins available: ${admins.size}`
    );

    // ======================================
    // NO ADMINS
    // ======================================

    if (admins.size === 0) {

      await player.send(
        "⚠️ **No support administrators are currently available.**\n\n" +
        "Please try again later."
      );

      return;

    }

    // ======================================
    // CREATE SUPPORT REQUEST
    // ======================================

    for (const [, admin] of admins) {

      try {

        const embed =
          new EmbedBuilder()
            .setTitle("🎫 NEW SUPPORT REQUEST")
            .setDescription(
              `👤 **Player:** ${player.tag}\n` +
              `🆔 **User ID:** ${player.id}\n\n` +
              `💬 **Message:**\n${message.content}`
            )
            .setFooter({
              text: "Grand Mafia RP Support"
            });

        const buttons =
          new ActionRowBuilder()
            .addComponents(

              new ButtonBuilder()
                .setCustomId(
                  `claim_${player.id}`
                )
                .setLabel("Claim")
                .setEmoji("🎫")
                .setStyle(
                  ButtonStyle.Primary
                )

            );

        await admin.send({
          embeds: [embed],
          components: [buttons]
        });

        console.log(
          `📨 Ticket sent to ${admin.user.tag}`
        );

      } catch (error) {

        console.error(
          `❌ Could not DM ${admin.user.tag}:`,
          error
        );

      }

    }

    // ======================================
    // PLAYER CONFIRMATION
    // ======================================

    await player.send(
      "👋 **Welcome to Grand Mafia RP Support!**\n\n" +
      "🎫 Your support request has been sent to our support team.\n\n" +
      "⏳ Please wait for an administrator to claim your request."
    );

  } catch (error) {

    console.error(
      "❌ Message system error:",
      error
    );

  }

});

// ==========================================
// CLAIM BUTTON
// ==========================================

client.on(
  Events.InteractionCreate,
  async interaction => {

    if (!interaction.isButton()) return;

    if (
      !interaction.customId.startsWith("claim_")
    ) return;

    const playerId =
      interaction.customId.replace(
        "claim_",
        ""
      );

    try {

      // ====================================
      // GET SERVER
      // ====================================

      const guild =
        await client.guilds.fetch(GUILD_ID);

      const member =
        await guild.members.fetch(
          interaction.user.id
        );

      // ====================================
      // CHECK SUPPORT ROLE
      // ====================================

      if (
        !member.roles.cache.has(
          SUPPORT_ROLE_ID
        )
      ) {

        return interaction.reply({
          content:
            "❌ You are not a Support Team member.",
          ephemeral: true
        });

      }

      // ====================================
      // CHECK ALREADY CLAIMED
      // ====================================

      if (tickets.has(playerId)) {

        return interaction.reply({
          content:
            "⚠️ This ticket has already been claimed.",
          ephemeral: true
        });

      }

      // ====================================
      // CREATE TICKET
      // ====================================

      tickets.set(playerId, {

        playerId: playerId,

        adminId:
          interaction.user.id,

        createdAt:
          Date.now()

      });

      // ====================================
      // UPDATE ADMIN MESSAGE
      // ====================================

      await interaction.update({

        content:
          `✅ **TICKET CLAIMED**\n\n` +
          `👮 Admin: ${interaction.user.tag}\n\n` +
          `💬 You can now reply to this DM.\n` +
          `Your messages will be sent directly to the player.`,

        embeds: [],

        components: []

      });

      // ====================================
      // NOTIFY PLAYER
      // ====================================

      try {

        const player =
          await client.users.fetch(playerId);

        await player.send(
          "👮 **Support has joined your request!**\n\n" +
          "💬 You can now continue your conversation here."
        );

      } catch (error) {

        console.error(
          "❌ Could not notify player:",
          error
        );

      }

      // ====================================
      // LOG CLAIM
      // ====================================

      try {

        const logChannel =
          await client.channels.fetch(
            LOG_CHANNEL_ID
          );

        await logChannel.send(
          `🎫 **TICKET CLAIMED**\n\n` +
          `👤 Player ID: ${playerId}\n` +
          `👮 Admin: ${interaction.user.tag}`
        );

      } catch (error) {

        console.error(
          "❌ Could not log ticket:",
          error
        );

      }

    } catch (error) {

      console.error(
        "❌ Claim error:",
        error
      );

    }

  }
);

// ==========================================
// LOGIN
// ==========================================

console.log(
  "🔄 Connecting to Discord..."
);

client.login(TOKEN)

  .then(() => {

    console.log(
      "🔐 Discord login successful!"
    );

  })

  .catch(error => {

    console.error(
      "❌ DISCORD LOGIN FAILED:"
    );

    console.error(error);

    process.exit(1);

  });
