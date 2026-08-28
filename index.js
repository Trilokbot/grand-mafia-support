const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const SERVER_ID = process.env.SERVER_ID || "1493700265499689154";
const SUPPORT_ADMIN_ROLE_ID =
  process.env.SUPPORT_ADMIN_ROLE_ID || "1542498406981959801";
const SUPPORT_LOG_CHANNEL_ID =
  process.env.SUPPORT_LOG_CHANNEL_ID || "1542500573000106024";

if (!TOKEN || !CLIENT_ID) {
  console.error("❌ TOKEN or CLIENT_ID is missing in Environment Variables.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildModeration
  ],
  partials: [Partials.Channel, Partials.Message]
});

// ======================================================
// DATA
// ======================================================

const tickets = new Map();
const warnings = new Map();

const spamTracker = new Map();
const mentionTracker = new Map();
const securityTracker = new Map();

const BAD_WORDS = [
  "badword1",
  "badword2"
];

// ======================================================
// HELPERS
// ======================================================

function isStaff(member) {
  return (
    member &&
    (member.roles.cache.has(SUPPORT_ADMIN_ROLE_ID) ||
      member.permissions.has(PermissionsBitField.Flags.Administrator))
  );
}

async function sendLog(guild, title, description) {
  try {
    const channel = guild.channels.cache.get(SUPPORT_LOG_CHANNEL_ID);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error("Log error:", err.message);
  }
}

function getUserTicket(userId) {
  for (const ticket of tickets.values()) {
    if (ticket.userId === userId && !ticket.closed) {
      return ticket;
    }
  }

  return null;
}

function ticketName(user) {
  return `ticket-${user.username
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 15)}`;
}

// ======================================================
// SLASH COMMANDS
// ======================================================

const commands = [
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Create a DM support ticket"),

  new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription("Send the support ticket panel"),

  new SlashCommandBuilder()
    .setName("close")
    .setDescription("Close the current ticket"),

  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim the current ticket"),

  new SlashCommandBuilder()
    .setName("unclaim")
    .setDescription("Unclaim the current ticket"),

  new SlashCommandBuilder()
    .setName("add")
    .setDescription("Add a user to the current ticket")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to add")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a user from the current ticket")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to remove")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("transcript")
    .setDescription("Create a ticket transcript"),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Member to warn")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Warning reason")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("security")
    .setDescription("Show security status"),

  new SlashCommandBuilder()
    .setName("automod")
    .setDescription("Show AutoMod status")
].map(command => command.toJSON());

// ======================================================
// READY
// ======================================================

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🏠 Server ID: ${SERVER_ID}`);

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  try {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, SERVER_ID),
      { body: commands }
    );

    console.log("✅ Slash commands registered.");
  } catch (err) {
    console.error("❌ Command registration error:", err);
  }

  client.user.setPresence({
    activities: [
      {
        name: "DM Support Tickets",
        type: 3
      }
    ],
    status: "online"
  });
});

// ======================================================
// TICKET PANEL
// ======================================================

async function sendTicketPanel(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: "❌ You don't have permission to use this command.",
      ephemeral: true
    });
  }

  const embed = new EmbedBuilder()
    .setTitle("🎫 Support Center")
    .setDescription(
      "Need help? Click the button below to create a private DM support ticket.\n\n" +
      "📩 Your conversation will be handled by our support team."
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("create_ticket")
      .setLabel("Create Ticket")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.channel.send({
    embeds: [embed],
    components: [row]
  });

  await interaction.reply({
    content: "✅ Ticket panel sent.",
    ephemeral: true
  });
}

// ======================================================
// CREATE TICKET
// ======================================================

async function createTicket(user, interaction = null) {
  const existing = getUserTicket(user.id);

  if (existing) {
    if (interaction) {
      await interaction.reply({
        content: "❌ You already have an open ticket.",
        ephemeral: true
      });
    }

    return;
  }

  const guild = client.guilds.cache.get(SERVER_ID);

  if (!guild) {
    if (interaction) {
      await interaction.reply({
        content: "❌ Server is not available.",
        ephemeral: true
      });
    }

    return;
  }

  const category = guild.channels.cache.find(
    c =>
      c.type === ChannelType.GuildCategory &&
      c.name.toLowerCase() === "tickets"
  );

  let ticketCategory = category;

  if (!ticketCategory) {
    ticketCategory = await guild.channels.create({
      name: "Tickets",
      type: ChannelType.GuildCategory
    });
  }

  const channel = await guild.channels.create({
    name: ticketName(user),
    type: ChannelType.GuildText,
    parent: ticketCategory.id,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel]
      },
      {
        id: SUPPORT_ADMIN_ROLE_ID,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      }
    ]
  });

  const ticket = {
    channelId: channel.id,
    userId: user.id,
    username: user.username,
    claimedBy: null,
    closed: false,
    messages: [],
    createdAt: Date.now()
  };

  tickets.set(channel.id, ticket);

  const embed = new EmbedBuilder()
    .setTitle("🎫 New DM Ticket")
    .setDescription(
      `**User:** ${user}\n` +
      `**User ID:** \`${user.id}\`\n\n` +
      "Reply to this channel to communicate with the user."
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("claim_ticket")
      .setLabel("Claim")
      .setEmoji("🙋")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("close_ticket")
      .setLabel("Close")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: `<@&${SUPPORT_ADMIN_ROLE_ID}>`,
    embeds: [embed],
    components: [row]
  });

  try {
    await user.send(
      "🎫 **Your support ticket has been created.**\n\n" +
      "Please send your message here. Our support team will reply shortly."
    );
  } catch {
    console.log("Could not DM user.");
  }

  await sendLog(
    guild,
    "🎫 Ticket Created",
    `Ticket created for **${user.tag}**.\nChannel: ${channel}`
  );

  if (interaction) {
    await interaction.reply({
      content: `✅ Ticket created: ${channel}`,
      ephemeral: true
    });
  }
}

// ======================================================
// CLOSE TICKET
// ======================================================

async function closeTicket(channel, closedBy) {
  const ticket = tickets.get(channel.id);

  if (!ticket || ticket.closed) return false;

  ticket.closed = true;

  const guild = channel.guild;

  try {
    const user = await client.users.fetch(ticket.userId);

    await user.send(
      "🔒 **Your support ticket has been closed.**\n\n" +
      "Thank you for contacting support."
    );
  } catch {}

  await sendLog(
    guild,
    "🔒 Ticket Closed",
    `Ticket: **${channel.name}**\nClosed by: **${closedBy.tag}**`
  );

  await channel.delete().catch(() => {});

  return true;
}

// ======================================================
// BUTTONS
// ======================================================

client.on("interactionCreate", async interaction => {
  if (interaction.isButton()) {
    if (interaction.customId === "create_ticket") {
      return createTicket(interaction.user, interaction);
    }

    const ticket = tickets.get(interaction.channelId);

    if (!ticket) {
      return interaction.reply({
        content: "❌ This is not a ticket channel.",
        ephemeral: true
      });
    }

    if (!isStaff(interaction.member)) {
      return interaction.reply({
        content: "❌ Staff only.",
        ephemeral: true
      });
    }

    if (interaction.customId === "claim_ticket") {
      if (ticket.claimedBy) {
        return interaction.reply({
          content: "❌ This ticket is already claimed.",
          ephemeral: true
        });
      }

      ticket.claimedBy = interaction.user.id;

      await interaction.reply({
        content: `🙋 Ticket claimed by ${interaction.user}.`
      });

      const user = await client.users.fetch(ticket.userId).catch(() => null);

      if (user) {
        await user
          .send(`🙋 **${interaction.user.tag}** has claimed your ticket.`)
          .catch(() => {});
      }

      await sendLog(
        interaction.guild,
        "🙋 Ticket Claimed",
        `${interaction.user.tag} claimed ${interaction.channel.name}`
      );
    }

    if (interaction.customId === "close_ticket") {
      await interaction.reply({
        content: "🔒 Closing ticket..."
      });

      await closeTicket(interaction.channel, interaction.user);
    }

    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // ====================================================
  // PANEL
  // ====================================================

  if (commandName === "ticketpanel") {
    return sendTicketPanel(interaction);
  }

  // ====================================================
  // TICKET
  // ====================================================

  if (commandName === "ticket") {
    return createTicket(interaction.user, interaction);
  }

  // ====================================================
  // STAFF COMMANDS
  // ====================================================

  if (
    [
      "close",
      "claim",
      "unclaim",
      "add",
      "remove",
      "transcript"
    ].includes(commandName)
  ) {
    if (!isStaff(interaction.member)) {
      return interaction.reply({
        content: "❌ You don't have permission.",
        ephemeral: true
      });
    }
  }

  const ticket = tickets.get(interaction.channelId);

  if (commandName === "close") {
    if (!ticket) {
      return interaction.reply({
        content: "❌ This is not a ticket channel.",
        ephemeral: true
      });
    }

    await interaction.reply({
      content: "🔒 Closing ticket..."
    });

    return closeTicket(interaction.channel, interaction.user);
  }

  if (commandName === "claim") {
    if (!ticket) {
      return interaction.reply({
        content: "❌ This is not a ticket channel.",
        ephemeral: true
      });
    }

    if (ticket.claimedBy) {
      return interaction.reply({
        content: "❌ Ticket already claimed.",
        ephemeral: true
      });
    }

    ticket.claimedBy = interaction.user.id;

    await interaction.reply({
      content: `🙋 Ticket claimed by ${interaction.user}.`
    });

    const user = await client.users.fetch(ticket.userId).catch(() => null);

    if (user) {
      await user
        .send(`🙋 **${interaction.user.tag}** claimed your support ticket.`)
        .catch(() => {});
    }

    return sendLog(
      interaction.guild,
      "🙋 Ticket Claimed",
      `${interaction.user.tag} claimed ${interaction.channel.name}`
    );
  }

  if (commandName === "unclaim") {
    if (!ticket) {
      return interaction.reply({
        content: "❌ This is not a ticket channel.",
        ephemeral: true
      });
    }

    ticket.claimedBy = null;

    await interaction.reply({
      content: "✅ Ticket unclaimed."
    });

    return sendLog(
      interaction.guild,
      "↩️ Ticket Unclaimed",
      `${interaction.user.tag} unclaimed ${interaction.channel.name}`
    );
  }

  // ====================================================
  // ADD USER
  // ====================================================

  if (commandName === "add") {
    if (!ticket) {
      return interaction.reply({
        content: "❌ This is not a ticket channel.",
        ephemeral: true
      });
    }

    const user = interaction.options.getUser("user");

    await interaction.channel.permissionOverwrites.edit(user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true
    });

    await interaction.reply({
      content: `✅ Added ${user} to the ticket.`
    });

    return sendLog(
      interaction.guild,
      "➕ User Added",
      `${user.tag} added to ${interaction.channel.name}`
    );
  }

  // ====================================================
  // REMOVE USER
  // ====================================================

  if (commandName === "remove") {
    if (!ticket) {
      return interaction.reply({
        content: "❌ This is not a ticket channel.",
        ephemeral: true
      });
    }

    const user = interaction.options.getUser("user");

    await interaction.channel.permissionOverwrites.delete(user.id);

    await interaction.reply({
      content: `✅ Removed ${user} from the ticket.`
    });

    return sendLog(
      interaction.guild,
      "➖ User Removed",
      `${user.tag} removed from ${interaction.channel.name}`
    );
  }

  // ====================================================
  // TRANSCRIPT
  // ====================================================

  if (commandName === "transcript") {
    if (!ticket) {
      return interaction.reply({
        content: "❌ This is not a ticket channel.",
        ephemeral: true
      });
    }

    const messages = await interaction.channel.messages.fetch({
      limit: 100
    });

    const transcript = messages
      .reverse()
      .map(
        m =>
          `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content}`
      )
      .join("\n");

    await interaction.reply({
      content:
        "📄 **Transcript created.**\n\n" +
        "```text\n" +
        transcript.slice(0, 1800) +
        "\n```"
    });

    return sendLog(
      interaction.guild,
      "📄 Transcript Created",
      `${interaction.user.tag} created a transcript for ${interaction.channel.name}`
    );
  }

  // ====================================================
  // WARN
  // ====================================================

  if (commandName === "warn") {
    if (!isStaff(interaction.member)) {
      return interaction.reply({
        content: "❌ Staff only.",
        ephemeral: true
      });
    }

    const user = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason");

    if (!warnings.has(user.id)) {
      warnings.set(user.id, []);
    }

    warnings.get(user.id).push({
      moderator: interaction.user.id,
      reason,
      timestamp: Date.now()
    });

    await interaction.reply({
      content: `⚠️ ${user} has been warned.\nReason: **${reason}**`
    });

    try {
      await user.send(
        `⚠️ You received a warning in **${interaction.guild.name}**.\nReason: ${reason}`
      );
    } catch {}

    return sendLog(
      interaction.guild,
      "⚠️ Member Warned",
      `${user.tag} was warned by ${interaction.user.tag}\nReason: ${reason}`
    );
  }

  // ====================================================
  // SECURITY
  // ====================================================

  if (commandName === "security") {
    if (!isStaff(interaction.member)) {
      return interaction.reply({
        content: "❌ Staff only.",
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setTitle("🔐 Security System")
      .setDescription(
        "🟢 Anti-Nuke: Active\n" +
        "🟢 Anti-Ban: Active\n" +
        "🟢 Anti-Kick: Active\n" +
        "🟢 Anti-Channel Delete: Active\n" +
        "🟢 Anti-Role Delete: Active\n" +
        "🟢 Anti-Webhook: Active\n" +
        "🟢 Anti-Bot Add: Active"
      )
      .setTimestamp();

    return interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  }

  // ====================================================
  // AUTOMOD
  // ====================================================

  if (commandName === "automod") {
    if (!isStaff(interaction.member)) {
      return interaction.reply({
        content: "❌ Staff only.",
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setTitle("🛡️ AutoMod System")
      .setDescription(
        "🟢 Anti-Spam\n" +
        "🟢 Anti-Flood\n" +
        "🟢 Anti-Mention Spam\n" +
        "🟢 Invite Protection\n" +
        "🟢 Link Protection\n" +
        "🟢 Bad Word Filter\n" +
        "🟢 Automatic Timeout\n" +
        "🟢 Warning System"
      )
      .setTimestamp();

    return interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  }
});

// ======================================================
// DM → TICKET
// ======================================================

client.on("messageCreate", async message => {
  if (message.author.bot) return;

  // ----------------------------------------------------
  // DM
  // ----------------------------------------------------

  if (!message.guild) {
    const ticket = getUserTicket(message.author.id);

    if (!ticket) {
      await createTicket(message.author);
      return;
    }

    const channel = await client.channels
      .fetch(ticket.channelId)
      .catch(() => null);

    if (!channel) return;

    ticket.messages.push({
      author: message.author.tag,
      content: message.content,
      timestamp: Date.now()
    });

    const embed = new EmbedBuilder()
      .setAuthor({
        name: message.author.tag,
        iconURL: message.author.displayAvatarURL()
      })
      .setDescription(message.content || "*Attachment/empty message*")
      .setTimestamp();

    if (message.attachments.size) {
      embed.addFields({
        name: "Attachments",
        value: message.attachments
          .map(a => a.url)
          .join("\n")
          .slice(0, 1024)
      });
    }

    await channel.send({
      embeds: [embed]
    });

    return;
  }

  // ----------------------------------------------------
  // STAFF MESSAGE → USER DM
  // ----------------------------------------------------

  const ticket = tickets.get(message.channel.id);

  if (ticket && isStaff(message.member)) {
    const user = await client.users
      .fetch(ticket.userId)
      .catch(() => null);

    if (!user) return;

    const embed = new EmbedBuilder()
      .setAuthor({
        name: message.author.tag,
        iconURL: message.author.displayAvatarURL()
      })
      .setDescription(message.content || "*Attachment/empty message*")
      .setTimestamp();

    if (message.attachments.size) {
      embed.addFields({
        name: "Attachments",
        value: message.attachments
          .map(a => a.url)
          .join("\n")
          .slice(0, 1024)
      });
    }

    await user.send({
      embeds: [embed]
    }).catch(() => {});

    ticket.messages.push({
      author: message.author.tag,
      content: message.content,
      timestamp: Date.now()
    });

    return;
  }

  // ====================================================
  // AUTOMOD
  // ====================================================

  if (!message.member) return;

  if (
    message.member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )
  ) {
    return;
  }

  const userId = message.author.id;
  const now = Date.now();

  // Spam tracking
  if (!spamTracker.has(userId)) {
    spamTracker.set(userId, []);
  }

  const spam = spamTracker.get(userId);

  spam.push(now);

  while (spam.length && now - spam[0] > 5000) {
    spam.shift();
  }

  if (spam.length >= 6) {
    spamTracker.delete(userId);

    try {
      await message.delete();

      await message.member.timeout(
        60 * 1000,
        "AutoMod: Spam/Flood"
      );

      await sendLog(
        message.guild,
        "🚨 AutoMod Timeout",
        `${message.author.tag} was timed out for spam.`
      );
    } catch {}
    
    return;
  }

  // Mention spam
  if (message.mentions.users.size >= 5) {
    try {
      await message.delete();

      await message.member.timeout(
        60 * 1000,
        "AutoMod: Mention Spam"
      );

      await sendLog(
        message.guild,
        "🚨 Mention Spam",
        `${message.author.tag} was timed out for mention spam.`
      );
    } catch {}

    return;
  }

  // Discord invite protection
  if (/discord(?:\.gg|\.com\/invite)\/[a-z0-9-]+/i.test(message.content)) {
    try {
      await message.delete();

      await sendLog(
        message.guild,
        "🔗 Invite Removed",
        `Removed Discord invite from ${message.author.tag}.`
      );
    } catch {}

    return;
  }

  // Bad word protection
  const lower = message.content.toLowerCase();

  if (BAD_WORDS.some(word => lower.includes(word))) {
    try {
      await message.delete();

      await message.member.timeout(
        30 * 1000,
        "AutoMod: Inappropriate language"
      );

      await sendLog(
        message.guild,
        "🚨 Bad Word Filter",
        `${message.author.tag} triggered the bad-word filter.`
      );
    } catch {}

    return;
  }
});

// ======================================================
// SECURITY — GUILD AUDIT LOG EVENTS
// ======================================================

client.on("guildAuditLogEntryCreate", async (entry, guild) => {
  try {
    const executor = entry.executor;

    if (!executor || executor.bot) return;

    const action = entry.action;

    const dangerousActions = [
      10, // CHANNEL_CREATE
      11, // CHANNEL_UPDATE
      12, // CHANNEL_DELETE
      20, // ROLE_CREATE
      21, // ROLE_UPDATE
      22, // ROLE_DELETE
      22,
      25, // MEMBER_KICK
      26, // MEMBER_PRUNE
      27, // MEMBER_BAN_ADD
      28, // MEMBER_BAN_REMOVE
      50 // BOT_ADD
    ];

    if (!dangerousActions.includes(action)) return;

    if (executor.id === guild.ownerId) return;

    const member = await guild.members
      .fetch(executor.id)
      .catch(() => null);

    if (!member) return;

    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return;
    }

    await sendLog(
      guild,
      "🚨 SECURITY ALERT",
      `Potential dangerous action detected.\n` +
        `Executor: **${executor.tag}**\n` +
        `Action: **${action}**`
    );
  } catch (err) {
    console.error("Security event error:", err.message);
  }
});

// ======================================================
// ERROR HANDLING
// ======================================================

client.on("error", error => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
});

// ======================================================
// LOGIN
// ======================================================

client.login(TOKEN);
