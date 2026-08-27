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

// ==============================
// CONFIG
// ==============================

const TOKEN = process.env.DISCORD_TOKEN;

const SUPPORT_ROLE_ID = "1542498406981959801";
const LOG_CHANNEL_ID = "1542500573000106024";
const GUILD_ID = "1493700265499689154";

// ==============================
// CHECK TOKEN
// ==============================

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN is missing!");
  process.exit(1);
}

// ==============================
// WEB SERVER FOR RENDER
// ==============================

const app = express();

app.get("/", (req, res) => {
  res.send("Grand Mafia Support Bot is Online!");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

// ==============================
// DISCORD CLIENT
// ==============================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ==============================
// TICKETS
// ==============================

const tickets = new Map();

// ==============================
// BOT READY
// ==============================

client.once(Events.ClientReady, () => {
  console.log(`✅ BOT ONLINE: ${client.user.tag}`);
  console.log(`🏠 Server ID: ${GUILD_ID}`);
  console.log(`👮 Support Role: ${SUPPORT_ROLE_ID}`);
});

// ==============================
// DISCORD ERROR HANDLING
// ==============================

client.on("error", error => {
  console.error("❌ Discord Client Error:", error);
});

client.on("shardError", error => {
  console.error("❌ Discord Shard Error:", error);
});

// ==============================
// PLAYER DM
// ==============================

client.on(Events.MessageCreate, async message => {

  if (message.author.bot) return;
  if (message.guild) return;

  const player = message.author;

  console.log(`📩 DM received from ${player.tag}`);

  // Existing ticket
  if (tickets.has(player.id)) {

    const ticket = tickets.get(player.id);

    try {

      const admin = await client.users.fetch(ticket.adminId);

      await admin.send(
        `📩 **PLAYER MESSAGE**\n\n` +
        `👤 Player: ${player.tag}\n` +
        `🆔 ID: ${player.id}\n\n` +
        `💬 ${message.content}`
      );

      console.log(`➡️ Message forwarded to ${admin.tag}`);

    } catch (error) {

      console.error("❌ Could not contact admin:", error);

    }

    return;
  }

  // Get server
  let guild;

  try {

    guild = await client.guilds.fetch(GUILD_ID);

  } catch (error) {

    console.error("❌ Cannot access server:", error);

    await player.send(
      "⚠️ Support system is currently unavailable."
    );

    return;
  }

  // Get members
  let members;

  try {

    members = await guild.members.fetch();

  } catch (error) {

    console.error("❌ Cannot fetch members:", error);

    return;
  }

  // Find support staff
  const admins = members.filter(member =>
    member.roles.cache.has(SUPPORT_ROLE_ID) &&
    !member.user.bot
  );

  console.log(`👮 Support admins found: ${admins.size}`);

  if (admins.size === 0) {

    await player.send(
      "⚠️ **No support administrators are currently available.**"
    );

    return;
  }

  // Send request
  for (const [, admin] of admins) {

    try {

      const embed = new EmbedBuilder()
        .setTitle("🎫 NEW SUPPORT REQUEST")
        .setDescription(
          `👤 **Player:** ${player.tag}\n` +
          `🆔 **User ID:** ${player.id}\n\n` +
          `💬 **Message:**\n${message.content}`
        )
        .setFooter({
          text: "Grand Mafia RP Support"
        });

      const row = new ActionRowBuilder().addComponents(

        new ButtonBuilder()
          .setCustomId(`claim_${player.id}`)
          .setLabel("Claim Ticket")
          .setEmoji("🎫")
          .setStyle(ButtonStyle.Primary)

      );

      await admin.send({
        embeds: [embed],
        components: [row]
      });

      console.log(`📨 Ticket sent to ${admin.user.tag}`);

    } catch (error) {

      console.error(
        `❌ Could not DM ${admin.user.tag}:`,
        error
      );

    }

  }

  await player.send(
    "👋 **Welcome to Grand Mafia RP Support!**\n\n" +
    "🎫 Your support request has been sent to our support team.\n\n" +
    "⏳ Please wait for an administrator to claim your request."
  );

});

// ==============================
// ADMIN REPLY
// ==============================

client.on(Events.MessageCreate, async message => {

  if (message.author.bot) return;
  if (message.guild) return;

  let ticket = null;

  for (const [, data] of tickets) {

    if (data.adminId === message.author.id) {

      ticket = data;
      break;

    }

  }

  if (!ticket) return;

  try {

    const player =
      await client.users.fetch(ticket.playerId);

    await player.send(message.content);

    await message.react("✅");

    console.log(
      `➡️ Admin ${message.author.tag} replied to player`
    );

  } catch (error) {

    console.error("❌ Failed to send admin reply:", error);

  }

});

// ==============================
// CLAIM BUTTON
// ==============================

client.on(Events.InteractionCreate, async interaction => {

  if (!interaction.isButton()) return;

  if (!interaction.customId.startsWith("claim_")) return;

  const playerId =
    interaction.customId.replace("claim_", "");

  try {

    const guild =
      await client.guilds.fetch(GUILD_ID);

    const member =
      await guild.members.fetch(interaction.user.id);

    if (!member.roles.cache.has(SUPPORT_ROLE_ID)) {

      return interaction.reply({
        content: "❌ You are not a Support Team member.",
        ephemeral: true
      });

    }

    if (tickets.has(playerId)) {

      return interaction.reply({
        content: "⚠️ This ticket has already been claimed.",
        ephemeral: true
      });

    }

    tickets.set(playerId, {
      playerId: playerId,
      adminId: interaction.user.id
    });

    await interaction.update({

      content:
        `✅ **TICKET CLAIMED**\n\n` +
        `👮 Admin: ${interaction.user.tag}\n\n` +
        `💬 Reply to this DM to communicate with the player.`,

      embeds: [],
      components: []

    });

    const player =
      await client.users.fetch(playerId);

    await player.send(
      `👮 **Support has joined your request!**\n\n` +
      `Your support administrator is **${interaction.user.username}**.\n\n` +
      `💬 You can now continue your conversation here.`
    );

    // Log
    try {

      const log =
        await client.channels.fetch(LOG_CHANNEL_ID);

      await log.send(
        `🎫 **SUPPORT TICKET CLAIMED**\n\n` +
        `👤 Player ID: ${playerId}\n` +
        `👮 Admin: ${interaction.user.tag}`
      );

    } catch (error) {

      console.error("❌ Logging failed:", error);

    }

  } catch (error) {

    console.error("❌ Claim error:", error);

  }

});

// ==============================
// LOGIN
// ==============================

console.log("🔄 Connecting to Discord...");

client.login(TOKEN)
  .then(() => {
    console.log("🔐 Discord login successful!");
  })
  .catch(error => {
    console.error("❌ DISCORD LOGIN FAILED:");
    console.error(error);
    process.exit(1);
  });
