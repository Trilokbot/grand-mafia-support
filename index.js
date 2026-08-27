require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  REST,
  Routes,
  ActivityType
} = require("discord.js");

const mongoose = require("mongoose");

// ===============================
// ENVIRONMENT
// ===============================

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

// ===============================
// CLIENT
// ===============================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.GuildMember
  ]
});

client.commands = new Collection();

// ===============================
// DATABASE
// ===============================

async function connectDatabase() {
  if (!DATABASE_URL) {
    console.log("⚠️ DATABASE_URL not provided.");
    console.log("ℹ️ Bot will continue without database.");
    return;
  }

  try {
    await mongoose.connect(DATABASE_URL);
    console.log("✅ Database connected.");
  } catch (error) {
    console.error("❌ Database connection failed:");
    console.error(error.message);
  }
}

// ===============================
// COMMAND STORAGE
// ===============================

const commands = [];

// ===============================
// COMMAND HELPER
// ===============================

function addCommand(command, execute) {
  commands.push(command);

  client.commands.set(command.name, {
    data: command,
    execute
  });
}

// ===============================
// BASIC COMMANDS
// ===============================

addCommand(
  {
    name: "ping",
    description: "Check bot latency."
  },
  async interaction => {
    await interaction.reply({
      content: `🏓 Pong! **${client.ws.ping}ms**`,
      ephemeral: true
    });
  }
);

addCommand(
  {
    name: "botinfo",
    description: "Show bot information."
  },
  async interaction => {
    await interaction.reply({
      content:
        `🤖 **Grand Mafia Bot**\n\n` +
        `📡 Ping: **${client.ws.ping}ms**\n` +
        `🛠️ Discord.js: **v14**\n` +
        `🌐 Servers: **${client.guilds.cache.size}**\n` +
        `👥 Users: **${client.users.cache.size}**`,
      ephemeral: true
    });
  }
);

addCommand(
  {
    name: "serverinfo",
    description: "Show server information."
  },
  async interaction => {
    const guild = interaction.guild;

    if (!guild) {
      return interaction.reply({
        content: "❌ This command can only be used in a server.",
        ephemeral: true
      });
    }

    await interaction.reply({
      content:
        `🏰 **${guild.name}**\n\n` +
        `👑 Owner: <@${guild.ownerId}>\n` +
        `👥 Members: **${guild.memberCount}**\n` +
        `💬 Channels: **${guild.channels.cache.size}**\n` +
        `🎭 Roles: **${guild.roles.cache.size}**\n` +
        `🆔 ID: \`${guild.id}\``,
      ephemeral: true
    });
  }
);

addCommand(
  {
    name: "userinfo",
    description: "Show information about a member.",
    options: [
      {
        name: "user",
        description: "Member to inspect.",
        type: 6,
        required: false
      }
    ]
  },
  async interaction => {
    const user =
      interaction.options.getUser("user") || interaction.user;

    const member = interaction.guild?.members.cache.get(user.id);

    await interaction.reply({
      content:
        `👤 **User Information**\n\n` +
        `Name: **${user.tag}**\n` +
        `ID: \`${user.id}\`\n` +
        `Created: <t:${Math.floor(user.createdTimestamp / 1000)}:R>\n` +
        `Joined: ${
          member
            ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
            : "Unknown"
        }`,
      ephemeral: true
    });
  }
);

addCommand(
  {
    name: "avatar",
    description: "Show a user's avatar.",
    options: [
      {
        name: "user",
        description: "User.",
        type: 6,
        required: false
      }
    ]
  },
  async interaction => {
    const user =
      interaction.options.getUser("user") || interaction.user;

    await interaction.reply({
      content: user.displayAvatarURL({
        size: 1024,
        extension: "png"
      })
    });
  }
);

addCommand(
  {
    name: "membercount",
    description: "Show server member count."
  },
  async interaction => {
    await interaction.reply({
      content: `👥 This server has **${interaction.guild.memberCount}** members.`,
      ephemeral: true
    });
  }
);

// ===============================
// HELP
// ===============================

addCommand(
  {
    name: "help",
    description: "Show available bot commands."
  },
  async interaction => {
    await interaction.reply({
      content:
        `🤖 **GRAND MAFIA BOT**\n\n` +
        `🛡️ Moderation\n` +
        `🔐 Security\n` +
        `🎫 Tickets\n` +
        `👑 Management\n` +
        `📊 Information\n` +
        `📈 Staff Activity\n` +
        `🤖 AI\n` +
        `🎮 Fun\n` +
        `📋 Logging\n\n` +
        `Currently loaded commands: **${client.commands.size}**\n\n` +
        `🚧 More systems will be added in the next parts.`,
      ephemeral: true
    });
  }
);

// ===============================
// READY
// ===============================

client.once("ready", async () => {
  console.log("");
  console.log("====================================");
  console.log("      GRAND MAFIA DISCORD BOT");
  console.log("====================================");
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🌐 Servers: ${client.guilds.cache.size}`);
  console.log(`📦 Commands: ${client.commands.size}`);
  console.log("====================================");

  client.user.setPresence({
    activities: [
      {
        name: "Grand Mafia RP",
        type: ActivityType.Playing
      }
    ],
    status: "online"
  });

  // Register slash commands globally
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      {
        body: commands
      }
    );

    console.log(`✅ ${commands.length} slash commands registered.`);
  } catch (error) {
    console.error("❌ Command registration failed:");
    console.error(error);
  }

  await connectDatabase();
});

// ===============================
// INTERACTION HANDLER
// ===============================

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    return interaction.reply({
      content: "❌ Command not found.",
      ephemeral: true
    }).catch(() => {});
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(
      `❌ Error in /${interaction.commandName}:`,
      error
    );

    const message = {
      content: "❌ An unexpected error occurred while running this command.",
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(message).catch(() => {});
    } else {
      await interaction.reply(message).catch(() => {});
    }
  }
});

// ===============================
// GLOBAL ERROR PROTECTION
// ===============================

process.on("unhandledRejection", error => {
  console.error("❌ Unhandled Promise Rejection:");
  console.error(error);
});

process.on("uncaughtException", error => {
  console.error("❌ Uncaught Exception:");
  console.error(error);
});

process.on("SIGINT", async () => {
  console.log("🛑 Shutting down bot...");

  try {
    await mongoose.connection.close();
  } catch {}

  client.destroy();
  process.exit(0);
});

// ===============================
// LOGIN
// ===============================

client.login(TOKEN);
