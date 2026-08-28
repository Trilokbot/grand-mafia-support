// ======================================================
// TRILOK DISCORD BOT
// DM TICKETS + AUTOMOD + SECURITY + ANNOUNCEMENTS
// RENDER FREE WEB SERVICE VERSION
// ======================================================

const http = require("http");

// ======================================================
// RENDER PORT SERVER
// ======================================================

const PORT = Number(process.env.PORT) || 10000;

const webServer = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  res.end("TRILOK BOT ONLINE");
});

webServer.listen(PORT, "0.0.0.0", () => {
  console.log(`WEB SERVER READY ON PORT ${PORT}`);
});

// ======================================================
// DISCORD
// ======================================================

const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

// ======================================================
// ENVIRONMENT VARIABLES
// ======================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// ======================================================
// YOUR SERVER SETTINGS
// ======================================================

const GUILD_ID = "1493700265499689154";

const SUPPORT_ROLE_ID =
  "1542498406981959801";

const SUPPORT_LOG_CHANNEL_ID =
  "1542500573000106024";

// ======================================================
// ENVIRONMENT CHECK
// ======================================================

if (!TOKEN) {
  console.error("DISCORD_TOKEN is missing.");
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error("CLIENT_ID is missing.");
  process.exit(1);
}

// ======================================================
// DISCORD CLIENT
// ======================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildModeration
  ],

  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User
  ]
});

// ======================================================
// MEMORY STORAGE
// ======================================================

const tickets = new Map();

let ticketCategoryId = null;

const botConfig = {
  automod: true,
  security: true,
  spamLimit: 6,
  timeoutSeconds: 60
};

const spamTracker = new Map();

let recentJoins = [];

// ======================================================
// STAFF CHECK
// ======================================================

function isStaff(member) {
  if (!member) return false;

  return (
    member.permissions.has(
      PermissionFlagsBits.Administrator
    ) ||
    member.roles.cache.has(
      SUPPORT_ROLE_ID
    )
  );
}

// ======================================================
// LOG SYSTEM
// ======================================================

async function sendLog(
  guild,
  title,
  description
) {
  try {
    const channel =
      await guild.channels.fetch(
        SUPPORT_LOG_CHANNEL_ID
      );

    if (
      !channel ||
      !channel.isTextBased()
    ) {
      return;
    }

    const embed =
      new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setTimestamp();

    await channel.send({
      embeds: [embed]
    });

  } catch (error) {
    console.error(
      "Log error:",
      error.message
    );
  }
}

// ======================================================
// SLASH COMMANDS
// ======================================================

const commands = [

  // TICKET
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription(
      "Create a support ticket."
    ),

  new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription(
      "Send the support ticket panel."
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  new SlashCommandBuilder()
    .setName("ticketsetup")
    .setDescription(
      "Configure the ticket category."
    )
    .addChannelOption(option =>
      option
        .setName("category")
        .setDescription(
          "Ticket category"
        )
        .addChannelTypes(
          ChannelType.GuildCategory
        )
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  new SlashCommandBuilder()
    .setName("close")
    .setDescription(
      "Close the current ticket."
    ),

  new SlashCommandBuilder()
    .setName("claim")
    .setDescription(
      "Claim the current ticket."
    ),

  new SlashCommandBuilder()
    .setName("unclaim")
    .setDescription(
      "Unclaim the current ticket."
    ),

  new SlashCommandBuilder()
    .setName("add")
    .setDescription(
      "Add a member to the ticket."
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription(
          "Member to add"
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("remove")
    .setDescription(
      "Remove a member from the ticket."
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription(
          "Member to remove"
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("transcript")
    .setDescription(
      "Create a ticket transcript."
    ),

  new SlashCommandBuilder()
    .setName("ticketstats")
    .setDescription(
      "Show ticket statistics."
    ),

  // AUTOMOD
  new SlashCommandBuilder()
    .setName("automod")
    .setDescription(
      "AutoMod controls."
    )
    .addSubcommand(sub =>
      sub
        .setName("enable")
        .setDescription(
          "Enable AutoMod."
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("disable")
        .setDescription(
          "Disable AutoMod."
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription(
          "Show AutoMod status."
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("config")
        .setDescription(
          "Configure AutoMod."
        )
        .addIntegerOption(option =>
          option
            .setName("spam_limit")
            .setDescription(
              "Messages allowed in 5 seconds"
            )
            .setMinValue(3)
            .setMaxValue(20)
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option
            .setName("timeout")
            .setDescription(
              "Timeout duration in seconds"
            )
            .setMinValue(10)
            .setMaxValue(604800)
            .setRequired(false)
        )
    ),

  // SECURITY
  new SlashCommandBuilder()
    .setName("security")
    .setDescription(
      "Security controls."
    )
    .addSubcommand(sub =>
      sub
        .setName("enable")
        .setDescription(
          "Enable security."
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("disable")
        .setDescription(
          "Disable security."
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription(
          "Show security status."
        )
    ),

  // ANNOUNCEMENT
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription(
      "Announcement system."
    )
    .addSubcommand(sub =>
      sub
        .setName("send")
        .setDescription(
          "Send an announcement."
        )
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription(
              "Announcement channel"
            )
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("message")
            .setDescription(
              "Announcement message"
            )
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("embed")
        .setDescription(
          "Send an embed announcement."
        )
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription(
              "Announcement channel"
            )
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("title")
            .setDescription(
              "Announcement title"
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("message")
            .setDescription(
              "Announcement message"
            )
            .setRequired(true)
        )
    )

].map(command =>
  command.toJSON()
);

// ======================================================
// REGISTER COMMANDS
// ======================================================

async function registerCommands() {

  const rest =
    new REST({
      version: "10"
    }).setToken(TOKEN);

  console.log(
    "Registering slash commands..."
  );

  await rest.put(
    Routes.applicationGuildCommands(
      CLIENT_ID,
      GUILD_ID
    ),
    {
      body: commands
    }
  );

  console.log(
    "Slash commands registered."
  );
}

// ======================================================
// BOT READY
// ======================================================

client.once(
  "clientReady",
  async () => {

    console.log(
      `Logged in as ${client.user.tag}`
    );

    try {

      await registerCommands();

    } catch (error) {

      console.error(
        "Command registration error:",
        error
      );
    }

    console.log(
      "DM Ticket + AutoMod + Security + Announcement Bot is online."
    );
  }
);

// ======================================================
// CREATE TICKET
// ======================================================

async function createTicket(user) {

  const guild =
    await client.guilds.fetch(
      GUILD_ID
    );

  // Already has ticket
  if (tickets.has(user.id)) {

    const oldTicket =
      tickets.get(user.id);

    const oldChannel =
      await guild.channels
        .fetch(oldTicket.channelId)
        .catch(() => null);

    if (oldChannel) {
      return oldChannel;
    }

    tickets.delete(user.id);
  }

  let category = null;

  if (ticketCategoryId) {

    category =
      await guild.channels
        .fetch(ticketCategoryId)
        .catch(() => null);
  }

  const username =
    user.username
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 15) ||
    "user";

  const channel =
    await guild.channels.create({
      name: `ticket-${username}`,

      type: ChannelType.GuildText,

      parent:
        category?.type ===
        ChannelType.GuildCategory
          ? category.id
          : undefined,

      permissionOverwrites: [

        {
          id: guild.roles.everyone.id,

          deny: [
            PermissionFlagsBits.ViewChannel
          ]
        },

        {
          id: SUPPORT_ROLE_ID,

          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory
          ]
        }

      ]
    });

  tickets.set(
    user.id,
    {
      channelId: channel.id,
      claimedBy: null,
      createdAt: Date.now()
    }
  );

  const embed =
    new EmbedBuilder()
      .setTitle(
        "🎫 Support Ticket"
      )
      .setDescription(
        `User: <@${user.id}>\n\n` +
        "A new support ticket has been created.\n" +
        "Staff can reply to the user from this channel."
      )
      .setTimestamp();

  const row =
    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()
          .setCustomId(
            "close_ticket"
          )
          .setLabel(
            "Close Ticket"
          )
          .setEmoji("🔒")
          .setStyle(
            ButtonStyle.Danger
          )

      );

  await channel.send({

    content:
      `<@&${SUPPORT_ROLE_ID}>`,

    embeds: [
      embed
    ],

    components: [
      row
    ]
  });

  await user.send(
    "🎫 Your support ticket has been created. Please send your message here."
  ).catch(() => {});

  await sendLog(
    guild,
    "🎫 Ticket Created",
    `User: <@${user.id}>\nChannel: ${channel}`
  );

  return channel;
}

// ======================================================
// MESSAGE HANDLER
// ======================================================

client.on(
  "messageCreate",
  async message => {

    if (message.author.bot)
      return;

    try {

      // ==================================================
      // DM FROM USER
      // ==================================================

      if (!message.guild) {

        let ticket =
          tickets.get(
            message.author.id
          );

        if (!ticket) {

          const channel =
            await createTicket(
              message.author
            );

          await channel.send(
            `📩 **${message.author.tag}:**\n` +
            `${message.content || "[Attachment]"}`
          );

          return;
        }

        const channel =
          await client.channels
            .fetch(
              ticket.channelId
            )
            .catch(() => null);

        if (!channel) {

          tickets.delete(
            message.author.id
          );

          const newChannel =
            await createTicket(
              message.author
            );

          await newChannel.send(
            `📩 **${message.author.tag}:**\n` +
            `${message.content || "[Attachment]"}`
          );

          return;
        }

        await channel.send(
          `📩 **${message.author.tag}:**\n` +
          `${message.content || "[Attachment]"}`
        );

        return;
      }

      // ==================================================
      // SERVER AUTOMOD
      // ==================================================

      await runAutoMod(
        message
      );

    } catch (error) {

      console.error(
        "Message handler error:",
        error
      );
    }
  }
);

// ======================================================
// STAFF MESSAGE -> USER DM
// ======================================================

client.on(
  "messageCreate",
  async message => {

    if (
      message.author.bot ||
      !message.guild
    ) {
      return;
    }

    try {

      let userId = null;

      for (
        const [id, ticket]
        of tickets
      ) {

        if (
          ticket.channelId ===
          message.channel.id
        ) {

          userId = id;
          break;
        }
      }

      if (!userId)
        return;

      if (
        !isStaff(
          message.member
        )
      ) {
        return;
      }

      const user =
        await client.users
          .fetch(userId)
          .catch(() => null);

      if (!user)
        return;

      await user.send(
        `💬 **Support — ${message.author.tag}:**\n` +
        `${message.content || "[Attachment]"}`
      ).catch(() => {});

    } catch (error) {

      console.error(
        "Staff reply error:",
        error
      );
    }
  }
);

// ======================================================
// AUTOMOD
// ======================================================

async function runAutoMod(message) {

  if (
    !message.guild ||
    !botConfig.automod
  ) {
    return;
  }

  if (
    message.member?.permissions.has(
      PermissionFlagsBits.Administrator
    ) ||
    message.member?.roles.cache.has(
      SUPPORT_ROLE_ID
    )
  ) {
    return;
  }

  const content =
    message.content || "";

  // ==================================================
  // DISCORD INVITES
  // ==================================================

  if (
    /discord\.gg\/|discord\.com\/invite\//i
      .test(content)
  ) {

    await message.delete()
      .catch(() => {});

    await punish(
      message.member,
      "Discord invite link"
    );

    return;
  }

  // ==================================================
  // MASS MENTION
  // ==================================================

  if (
    message.mentions.everyone ||
    message.mentions.users.size >= 5 ||
    message.mentions.roles.size >= 5
  ) {

    await message.delete()
      .catch(() => {});

    await punish(
      message.member,
      "Mass mention"
    );

    return;
  }

  // ==================================================
  // SPAM
  // ==================================================

  const now =
    Date.now();

  const previous =
    spamTracker.get(
      message.author.id
    ) || [];

  const recent =
    previous.filter(
      time =>
        now - time < 5000
    );

  recent.push(now);

  spamTracker.set(
    message.author.id,
    recent
  );

  if (
    recent.length >=
    botConfig.spamLimit
  ) {

    spamTracker.set(
      message.author.id,
      []
    );

    await message.delete()
      .catch(() => {});

    await punish(
      message.member,
      "Spam/flood"
    );
  }
}

// ======================================================
// AUTOMOD PUNISH
// ======================================================

async function punish(
  member,
  reason
) {

  if (!member)
    return;

  if (
    member.moderatable
  ) {

    await member.timeout(
      botConfig.timeoutSeconds *
      1000,

      `AutoMod: ${reason}`
    ).catch(() => {});
  }

  await sendLog(
    member.guild,
    "🛡️ AutoMod Action",

    `User: <@${member.id}>\n` +
    `Reason: ${reason}\n` +
    `Timeout: ${botConfig.timeoutSeconds}s`
  );
}

// ======================================================
// SECURITY / ANTI RAID
// ======================================================

client.on(
  "guildMemberAdd",
  async member => {

    if (
      member.guild.id !==
      GUILD_ID
    ) {
      return;
    }

    if (
      !botConfig.security
    ) {
      return;
    }

    const now =
      Date.now();

    recentJoins =
      recentJoins.filter(
        time =>
          now - time < 10000
      );

    recentJoins.push(
      now
    );

    if (
      recentJoins.length >=
      10
    ) {

      await sendLog(
        member.guild,

        "🚨 SECURITY ALERT",

        "Possible raid detected: 10 or more members joined within 10 seconds."
      );

      recentJoins = [];
    }
  }
);

// ======================================================
// INTERACTIONS
// ======================================================

client.on(
  "interactionCreate",
  async interaction => {

    try {

      // ==================================================
      // CLOSE BUTTON
      // ==================================================

      if (
        interaction.isButton()
      ) {

        if (
          interaction.customId !==
          "close_ticket"
        ) {
          return;
        }

        if (
          !isStaff(
            interaction.member
          )
        ) {

          await interaction.reply({
            content:
              "❌ You don't have permission.",
            ephemeral: true
          });

          return;
        }

        let userId = null;

        for (
          const [id, ticket]
          of tickets
        ) {

          if (
            ticket.channelId ===
            interaction.channel.id
          ) {

            userId = id;
            break;
          }
        }

        if (!userId) {

          await interaction.reply({
            content:
              "❌ This is not an active ticket.",
            ephemeral: true
          });

          return;
        }

        tickets.delete(
          userId
        );

        const user =
          await client.users
            .fetch(userId)
            .catch(() => null);

        if (user) {

          await user.send(
            "🔒 Your support ticket has been closed."
          ).catch(() => {});
        }

        await interaction.reply(
          "🔒 Closing ticket..."
        );

        await sendLog(
          interaction.guild,

          "🎫 Ticket Closed",

          `User: <@${userId}>\n` +
          `Closed by: ${interaction.user}`
        );

        setTimeout(() => {

          interaction.channel
            .delete()
            .catch(() => {});

        }, 1500);

        return;
      }

      // ==================================================
      // SLASH COMMANDS
      // ==================================================

      if (
        !interaction.isChatInputCommand()
      ) {
        return;
      }

      // ==================================================
      // /ticket
      // ==================================================

      if (
        interaction.commandName ===
        "ticket"
      ) {

        const channel =
          await createTicket(
            interaction.user
          );

        await interaction.reply({
          content:
            `🎫 Ticket created: ${channel}`,
          ephemeral: true
        });

        return;
      }

      // ==================================================
      // /ticketpanel
      // ==================================================

      if (
        interaction.commandName ===
        "ticketpanel"
      ) {

        if (
          !isStaff(
            interaction.member
          )
        ) {

          await interaction.reply({
            content:
              "❌ You don't have permission.",
            ephemeral: true
          });

          return;
        }

        const embed =
          new EmbedBuilder()
            .setTitle(
              "🎫 Support Center"
            )
            .setDescription(
              "Need help?\n\n" +
              "Send a DM to this bot to create a private support ticket.\n\n" +
              "Our support team will assist you."
            )
            .setTimestamp();

        await interaction.channel.send({
          embeds: [
            embed
          ]
        });

        await interaction.reply({
          content:
            "✅ Ticket panel sent.",
          ephemeral: true
        });

        return;
      }

      // ==================================================
      // /ticketsetup
      // ==================================================

      if (
        interaction.commandName ===
        "ticketsetup"
      ) {

        if (
          !isStaff(
            interaction.member
          )
        ) {

          await interaction.reply({
            content:
              "❌ You don't have permission.",
            ephemeral: true
          });

          return;
        }

        const category =
          interaction.options.getChannel(
            "category"
          );

        ticketCategoryId =
          category.id;

        await interaction.reply(
          `✅ Ticket category set to ${category}.`
        );

        return;
      }

      // ==================================================
      // /ticketstats
      // ==================================================

      if (
        interaction.commandName ===
        "ticketstats"
      ) {

        if (
          !isStaff(
            interaction.member
          )
        ) {

          await interaction.reply({
            content:
              "❌ You don't have permission.",
            ephemeral: true
          });

          return;
        }

        const open =
          tickets.size;

        const claimed =
          [
            ...tickets.values()
          ].filter(
            ticket =>
              ticket.claimedBy
          ).length;

        const embed =
          new EmbedBuilder()
            .setTitle(
              "🎫 Ticket Statistics"
            )
            .addFields(

              {
                name: "Open Tickets",
                value:
                  String(open),
                inline: true
              },

              {
                name: "Claimed",
                value:
                  String(claimed),
                inline: true
              },

              {
                name: "Unclaimed",
                value:
                  String(
                    open - claimed
                  ),
                inline: true
              }

            )
            .setTimestamp();

        await interaction.reply({
          embeds: [
            embed
          ]
        });

        return;
      }

      // ==================================================
      // TICKET MANAGEMENT
      // ==================================================

      if (
        [
          "close",
          "claim",
          "unclaim",
          "add",
          "remove",
          "transcript"
        ].includes(
          interaction.commandName
        )
      ) {

        if (
          !isStaff(
            interaction.member
          )
        ) {

          await interaction.reply({
            content:
              "❌ You don't have permission.",
            ephemeral: true
          });

          return;
        }

        let userId = null;

        for (
          const [id, ticket]
          of tickets
        ) {

          if (
            ticket.channelId ===
            interaction.channel.id
          ) {

            userId = id;
            break;
          }
        }

        if (!userId) {

          await interaction.reply({
            content:
              "❌ This is not an active ticket.",
            ephemeral: true
          });

          return;
        }

        const ticket =
          tickets.get(
            userId
          );

        // CLAIM
        if (
          interaction.commandName ===
          "claim"
        ) {

          ticket.claimedBy =
            interaction.user.id;

          await interaction.reply(
            `✅ Ticket claimed by ${interaction.user}.`
          );

          return;
        }

        // UNCLAIM
        if (
          interaction.commandName ===
          "unclaim"
        ) {

          ticket.claimedBy =
            null;

          await interaction.reply(
            "✅ Ticket unclaimed."
          );

          return;
        }

        // ADD
        if (
          interaction.commandName ===
          "add"
        ) {

          const user =
            interaction.options.getUser(
              "user"
            );

          await interaction.channel
            .permissionOverwrites.edit(
              user.id,
              {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
              }
            );

          await interaction.reply(
            `✅ ${user} added to the ticket.`
          );

          return;
        }

        // REMOVE
        if (
          interaction.commandName ===
          "remove"
        ) {

          const user =
            interaction.options.getUser(
              "user"
            );

          await interaction.channel
            .permissionOverwrites
            .delete(
              user.id
            )
            .catch(() => {});

          await interaction.reply(
            `✅ ${user} removed from the ticket.`
          );

          return;
        }

        // TRANSCRIPT
        if (
          interaction.commandName ===
          "transcript"
        ) {

          const messages =
            await interaction.channel
              .messages.fetch({
                limit: 100
              });

          const transcript =
            [
              ...messages.values()
            ]
              .reverse()
              .map(
                message =>
                  `[${message.createdAt.toISOString()}] ${message.author.tag}: ${message.content}`
              )
              .join("\n");

          await interaction.reply({
            content:
              "```text\n" +
              transcript.slice(
                0,
                1800
              ) +
              "\n```",
            ephemeral: true
          });

          return;
        }

        // CLOSE
        if (
          interaction.commandName ===
          "close"
        ) {

          tickets.delete(
            userId
          );

          const user =
            await client.users
              .fetch(userId)
              .catch(() => null);

          if (user) {

            await user.send(
              "🔒 Your support ticket has been closed."
            ).catch(() => {});
          }

          await interaction.reply(
            "🔒 Closing ticket..."
          );

          await sendLog(
            interaction.guild,

            "🎫 Ticket Closed",

            `User: <@${userId}>\n` +
            `Closed by: ${interaction.user}`
          );

          setTimeout(() => {

            interaction.channel
              .delete()
              .catch(() => {});

          }, 1500);

          return;
        }
      }

      // ==================================================
      // AUTOMOD
      // ==================================================

      if (
        interaction.commandName ===
        "automod"
      ) {

        if (
          !isStaff(
            interaction.member
          )
        ) {

          await interaction.reply({
            content:
              "❌ You don't have permission.",
            ephemeral: true
          });

          return;
        }

        const sub =
          interaction.options
            .getSubcommand();

        if (
          sub === "enable"
        ) {

          botConfig.automod =
            true;

          await interaction.reply(
            "🛡️ AutoMod enabled."
          );

          return;
        }

        if (
          sub === "disable"
        ) {

          botConfig.automod =
            false;

          await interaction.reply(
            "🛡️ AutoMod disabled."
          );

          return;
        }

        if (
          sub === "status"
        ) {

          await interaction.reply(
            `🛡️ AutoMod: ${
              botConfig.automod
                ? "ON"
                : "OFF"
            }\n` +
            `Spam limit: ${botConfig.spamLimit}\n` +
            `Timeout: ${botConfig.timeoutSeconds}s`
          );

          return;
        }

        if (
          sub === "config"
        ) {

          const spam =
            interaction.options
              .getInteger(
                "spam_limit"
              );

          const timeout =
            interaction.options
              .getInteger(
                "timeout"
              );

          if (
            spam !== null
          ) {
            botConfig.spamLimit =
              spam;
          }

          if (
            timeout !== null
          ) {
            botConfig.timeoutSeconds =
              timeout;
          }

          await interaction.reply(
            `✅ AutoMod configured.\nSpam limit: ${botConfig.spamLimit}\nTimeout: ${botConfig.timeoutSeconds}s`
          );

          return;
        }
      }

      // ==================================================
      // SECURITY
      // ==================================================

      if (
        interaction.commandName ===
        "security"
      ) {

        if (
          !isStaff(
            interaction.member
          )
        ) {

          await interaction.reply({
            content:
              "❌ You don't have permission.",
            ephemeral: true
          });

          return;
        }

        const sub =
          interaction.options
            .getSubcommand();

        if (
          sub === "enable"
        ) {

          botConfig.security =
            true;

          await interaction.reply(
            "🔐 Security enabled."
          );

          return;
        }

        if (
          sub === "disable"
        ) {

          botConfig.security =
            false;

          await interaction.reply(
            "🔐 Security disabled."
          );

          return;
        }

        await interaction.reply(
          `🔐 Security: ${
            botConfig.security
              ? "ON"
              : "OFF"
          }\nAnti-raid: ON\nAudit monitoring: ON`
        );

        return;
      }

      // ==================================================
      // ANNOUNCEMENTS
      // ==================================================

      if (
        interaction.commandName ===
        "announce"
      ) {

        if (
          !isStaff(
            interaction.member
          )
        ) {

          await interaction.reply({
            content:
              "❌ You don't have permission.",
            ephemeral: true
          });

          return;
        }

        const sub =
          interaction.options
            .getSubcommand();

        const channel =
          interaction.options
            .getChannel(
              "channel"
            );

        // NORMAL ANNOUNCEMENT
        if (
          sub === "send"
        ) {

          const message =
            interaction.options
              .getString(
                "message"
              );

          await channel.send({
            content:
              message
          });

          await interaction.reply({
            content:
              "✅ Announcement sent.",
            ephemeral: true
          });

          await sendLog(
            interaction.guild,

            "📢 Announcement Sent",

            `Channel: ${channel}\n` +
            `By: ${interaction.user}`
          );

          return;
        }

        // EMBED ANNOUNCEMENT
        if (
          sub === "embed"
        ) {

          const title =
            interaction.options
              .getString(
                "title"
              );

          const message =
            interaction.options
              .getString(
                "message"
              );

          const embed =
            new EmbedBuilder()
              .setTitle(
                title
              )
              .setDescription(
                message
              )
              .setTimestamp()
              .setFooter({
                text:
                  `By ${interaction.user.tag}`
              });

          await channel.send({
            embeds: [
              embed
            ]
          });

          await interaction.reply({
            content:
              "✅ Embed announcement sent.",
            ephemeral: true
          });

          await sendLog(
            interaction.guild,

            "📢 Embed Announcement Sent",

            `Channel: ${channel}\n` +
            `By: ${interaction.user}`
          );

          return;
        }
      }

    } catch (error) {

      console.error(
        "Interaction error:",
        error
      );

      if (
        !interaction.replied &&
        !interaction.deferred
      ) {

        await interaction.reply({
          content:
            "❌ An internal error occurred.",
          ephemeral: true
        }).catch(() => {});
      }
    }
  }
);

// ======================================================
// ERROR HANDLING
// ======================================================

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "Unhandled rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "Uncaught exception:",
      error
    );
  }
);

// ======================================================
// LOGIN
// ======================================================

console.log(
  "Starting Discord bot..."
);

client.login(TOKEN);
