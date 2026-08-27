require("dotenv").config();

const fs = require("fs");
const path = require("path");

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

/* =========================================================
   CONFIGURATION
========================================================= */

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

/*
   YOUR IDs
*/

const SERVER_ID = "1493700265499689154";

const SUPPORT_ADMIN_ROLE_ID = "1542498406981959801";

const SUPPORT_LOG_CHANNEL_ID = "1542500573000106024";

/* =========================================================
   CLIENT
========================================================= */

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildPresences
    ],

    partials: [
        Partials.Channel,
        Partials.Message,
        Partials.GuildMember
    ]
});

/* =========================================================
   DATA STORAGE
========================================================= */

const DATA_DIR = path.join(__dirname, "data");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

const DATA_FILE = path.join(DATA_DIR, "data.json");

let database = {
    warnings: {},
    autorole: {},
    verifyRole: {},
    tickets: {},
    settings: {}
};

function loadDatabase() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            saveDatabase();
            return;
        }

        const data = fs.readFileSync(DATA_FILE, "utf8");

        if (data.trim()) {
            database = {
                ...database,
                ...JSON.parse(data)
            };
        }
    } catch (error) {
        console.error("Database load error:", error);
    }
}

function saveDatabase() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(database, null, 2)
        );
    } catch (error) {
        console.error("Database save error:", error);
    }
}

loadDatabase();

/* =========================================================
   MEMORY
========================================================= */

const spamTracker = new Map();
const cooldowns = new Map();
const joinTracker = new Map();

/* =========================================================
   HELPERS
========================================================= */

function isOwner(member) {
    return member.id === member.guild.ownerId;
}

function isSupportAdmin(member) {
    if (!member) return false;

    if (isOwner(member)) return true;

    if (
        member.permissions.has(
            PermissionsBitField.Flags.Administrator
        )
    ) {
        return true;
    }

    return member.roles.cache.has(
        SUPPORT_ADMIN_ROLE_ID
    );
}

function hasPermission(member, permission) {
    if (!member) return false;

    if (isOwner(member)) return true;

    if (
        member.permissions.has(
            PermissionsBitField.Flags.Administrator
        )
    ) {
        return true;
    }

    if (
        member.permissions.has(permission)
    ) {
        return true;
    }

    if (
        member.roles.cache.has(
            SUPPORT_ADMIN_ROLE_ID
        )
    ) {
        return true;
    }

    return false;
}

function getLogChannel(guild) {
    return guild.channels.cache.get(
        SUPPORT_LOG_CHANNEL_ID
    );
}

async function sendLog(guild, title, description) {
    try {
        const channel = getLogChannel(guild);

        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setTimestamp();

        await channel.send({
            embeds: [embed]
        });
    } catch (error) {
        console.error("Log error:", error);
    }
}

function getWarningKey(guildId, userId) {
    return `${guildId}_${userId}`;
}

function getWarnings(guildId, userId) {
    const key = getWarningKey(
        guildId,
        userId
    );

    return database.warnings[key] || [];
}

function addWarning(guildId, userId, data) {
    const key = getWarningKey(
        guildId,
        userId
    );

    if (!database.warnings[key]) {
        database.warnings[key] = [];
    }

    database.warnings[key].push(data);

    saveDatabase();

    return database.warnings[key];
}

function clearWarnings(guildId, userId) {
    const key = getWarningKey(
        guildId,
        userId
    );

    delete database.warnings[key];

    saveDatabase();
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);

    if (seconds < 60) {
        return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);

    if (minutes < 60) {
        return `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);

    if (hours < 24) {
        return `${hours}h`;
    }

    return `${Math.floor(hours / 24)}d`;
}

/* =========================================================
   COMMAND COOLDOWN
========================================================= */

function checkCooldown(userId, commandName) {
    const key = `${userId}:${commandName}`;

    const now = Date.now();

    const last = cooldowns.get(key);

    if (!last) {
        cooldowns.set(key, now);
        return 0;
    }

    const difference = now - last;

    const cooldown = 1500;

    if (difference < cooldown) {
        return cooldown - difference;
    }

    cooldowns.set(key, now);

    return 0;
}

/* =========================================================
   COMMANDS
========================================================= */

const commands = [

    new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Check bot latency"),

    new SlashCommandBuilder()
        .setName("help")
        .setDescription("Show all bot commands"),

    new SlashCommandBuilder()
        .setName("serverinfo")
        .setDescription("Show server information"),

    new SlashCommandBuilder()
        .setName("userinfo")
        .setDescription("Show user information")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("User")
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("avatar")
        .setDescription("Show a user's avatar")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("User")
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("warn")
        .setDescription("Warn a member")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Member")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("reason")
                .setDescription("Reason")
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("warnings")
        .setDescription("View warnings")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Member")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("clearwarnings")
        .setDescription("Clear warnings")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Member")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("timeout")
        .setDescription("Timeout a member")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Member")
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName("minutes")
                .setDescription("Minutes")
                .setMinValue(1)
                .setMaxValue(40320)
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("reason")
                .setDescription("Reason")
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("untimeout")
        .setDescription("Remove timeout")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Member")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("kick")
        .setDescription("Kick a member")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Member")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("reason")
                .setDescription("Reason")
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("ban")
        .setDescription("Ban a member")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Member")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("reason")
                .setDescription("Reason")
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("unban")
        .setDescription("Unban a user")
        .addStringOption(option =>
            option
                .setName("userid")
                .setDescription("User ID")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("purge")
        .setDescription("Delete messages")
        .addIntegerOption(option =>
            option
                .setName("amount")
                .setDescription("1-100")
                .setMinValue(1)
                .setMaxValue(100)
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("lock")
        .setDescription("Lock the current channel"),

    new SlashCommandBuilder()
        .setName("unlock")
        .setDescription("Unlock the current channel"),

    new SlashCommandBuilder()
        .setName("slowmode")
        .setDescription("Set channel slowmode")
        .addIntegerOption(option =>
            option
                .setName("seconds")
                .setDescription("0-21600 seconds")
                .setMinValue(0)
                .setMaxValue(21600)
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("ticket")
        .setDescription("Create a support ticket"),

    new SlashCommandBuilder()
        .setName("close")
        .setDescription("Close the current ticket"),

    new SlashCommandBuilder()
        .setName("verify")
        .setDescription("Verify yourself"),

    new SlashCommandBuilder()
        .setName("setverify")
        .setDescription("Set verification role")
        .addRoleOption(option =>
            option
                .setName("role")
                .setDescription("Verification role")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("setautorole")
        .setDescription("Set automatic member role")
        .addRoleOption(option =>
            option
                .setName("role")
                .setDescription("Auto role")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("say")
        .setDescription("Send a message")
        .addStringOption(option =>
            option
                .setName("message")
                .setDescription("Message")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("announce")
        .setDescription("Send an announcement")
        .addStringOption(option =>
            option
                .setName("message")
                .setDescription("Announcement")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("botinfo")
        .setDescription("Show bot information"),

    new SlashCommandBuilder()
        .setName("staffcheck")
        .setDescription("Check your support staff status"),

    new SlashCommandBuilder()
        .setName("clear")
        .setDescription("Delete messages")
        .addIntegerOption(option =>
            option
                .setName("amount")
                .setDescription("Amount")
                .setMinValue(1)
                .setMaxValue(100)
                .setRequired(true)
        )

].map(command => command.toJSON());

/* =========================================================
   REGISTER COMMANDS
========================================================= */

async function registerCommands() {

    try {

        if (!TOKEN || !CLIENT_ID) {
            console.error(
                "TOKEN or CLIENT_ID is missing."
            );

            process.exit(1);
        }

        const rest = new REST({
            version: "10"
        }).setToken(TOKEN);

        await rest.put(
            Routes.applicationGuildCommands(
                CLIENT_ID,
                SERVER_ID
            ),
            {
                body: commands
            }
        );

        console.log(
            "✅ Slash commands registered successfully."
        );

    } catch (error) {

        console.error(
            "❌ Command registration failed:",
            error
        );
    }
}

/* =========================================================
   READY
========================================================= */

client.once("ready", () => {

    console.log(
        `✅ Logged in as ${client.user.tag}`
    );

    console.log(
        `🏠 Server ID: ${SERVER_ID}`
    );

    console.log(
        `🛡️ Support Role: ${SUPPORT_ADMIN_ROLE_ID}`
    );

    console.log(
        `📋 Log Channel: ${SUPPORT_LOG_CHANNEL_ID}`
    );

    client.user.setPresence({
        status: "online",
        activities: [
            {
                name: "Grand Mafia RP",
                type: 3
            }
        ]
    });
});

/* =========================================================
   INTERACTION HANDLER
========================================================= */

client.on(
    "interactionCreate",
    async interaction => {

        try {

            /* =========================================
               BUTTONS
            ========================================= */

            if (interaction.isButton()) {

                if (
                    interaction.customId ===
                    "create_ticket"
                ) {

                    const guild =
                        interaction.guild;

                    const existing =
                        guild.channels.cache.find(
                            channel =>
                                channel.type ===
                                ChannelType.GuildText &&
                                channel.topic ===
                                `ticket-owner:${interaction.user.id}`
                        );

                    if (existing) {

                        return interaction.reply({
                            content:
                                `🎫 You already have a ticket: ${existing}`,
                            ephemeral: true
                        });
                    }

                    const channel =
                        await guild.channels.create({
                            name:
                                `ticket-${interaction.user.username}`
                                    .toLowerCase()
                                    .replace(
                                        /[^a-z0-9-]/g,
                                        ""
                                    )
                                    .slice(0, 20),

                            type:
                                ChannelType.GuildText,

                            topic:
                                `ticket-owner:${interaction.user.id}`,

                            permissionOverwrites: [

                                {
                                    id:
                                        guild.roles.everyone.id,

                                    deny: [
                                        PermissionsBitField.Flags.ViewChannel
                                    ]
                                },

                                {
                                    id:
                                        interaction.user.id,

                                    allow: [
                                        PermissionsBitField.Flags.ViewChannel,
                                        PermissionsBitField.Flags.SendMessages,
                                        PermissionsBitField.Flags.ReadMessageHistory
                                    ]
                                },

                                {
                                    id:
                                        SUPPORT_ADMIN_ROLE_ID,

                                    allow: [
                                        PermissionsBitField.Flags.ViewChannel,
                                        PermissionsBitField.Flags.SendMessages,
                                        PermissionsBitField.Flags.ReadMessageHistory,
                                        PermissionsBitField.Flags.ManageMessages
                                    ]
                                }

                            ]
                        });

                    const embed =
                        new EmbedBuilder()
                            .setTitle(
                                "🎫 Support Ticket"
                            )
                            .setDescription(
                                `Welcome ${interaction.user}!\n\n` +
                                `Please explain your issue clearly.\n` +
                                `A support administrator will assist you.\n\n` +
                                `When finished, use the **Close Ticket** button.`
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
                            `<@&${SUPPORT_ADMIN_ROLE_ID}>`,
                        embeds: [embed],
                        components: [row]
                    });

                    database.tickets[
                        channel.id
                    ] = {
                        owner:
                            interaction.user.id,
                        created:
                            Date.now()
                    };

                    saveDatabase();

                    await sendLog(
                        guild,
                        "🎫 Ticket Created",
                        `**User:** ${interaction.user}\n` +
                        `**Channel:** ${channel}`
                    );

                    return interaction.reply({
                        content:
                            `✅ Ticket created: ${channel}`,
                        ephemeral: true
                    });
                }

                if (
                    interaction.customId ===
                    "close_ticket"
                ) {

                    const channel =
                        interaction.channel;

                    if (
                        !channel ||
                        channel.type !==
                            ChannelType.GuildText
                    ) {
                        return interaction.reply({
                            content:
                                "❌ Invalid ticket channel.",
                            ephemeral: true
                        });
                    }

                    const allowed =
                        isSupportAdmin(
                            interaction.member
                        ) ||
                        channel.topic ===
                            `ticket-owner:${interaction.user.id}`;

                    if (!allowed) {

                        return interaction.reply({
                            content:
                                "❌ You cannot close this ticket.",
                            ephemeral: true
                        });
                    }

                    await interaction.reply(
                        "🔒 Ticket will be closed in 5 seconds."
                    );

                    await sendLog(
                        interaction.guild,
                        "🔒 Ticket Closed",
                        `**Ticket:** ${channel.name}\n` +
                        `**Closed by:** ${interaction.user}`
                    );

                    setTimeout(async () => {

                        await channel.delete(
                            "Support ticket closed"
                        ).catch(() => {});

                        delete database.tickets[
                            channel.id
                        ];

                        saveDatabase();

                    }, 5000);

                    return;
                }

                return;
            }

            /* =========================================
               SLASH COMMANDS
            ========================================= */

            if (
                !interaction.isChatInputCommand()
            ) {
                return;
            }

            const cooldown =
                checkCooldown(
                    interaction.user.id,
                    interaction.commandName
                );

            if (cooldown > 0) {

                return interaction.reply({
                    content:
                        `⏳ Please wait ${(
                            cooldown / 1000
                        ).toFixed(1)} seconds.`,
                    ephemeral: true
                });
            }

            const command =
                interaction.commandName;

            /* =========================================
               PING
            ========================================= */

            if (command === "ping") {

                return interaction.reply({
                    content:
                        `🏓 Pong! WebSocket: ${client.ws.ping}ms`,
                    ephemeral: true
                });
            }

            /* =========================================
               HELP
            ========================================= */

            if (command === "help") {

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            "🤖 Support Bot Commands"
                        )
                        .setDescription(
                            "Complete command list"
                        )
                        .addFields(

                            {
                                name: "🔧 General",
                                value:
                                    "`/ping` `/help` `/serverinfo` `/userinfo` `/avatar` `/botinfo`"
                            },

                            {
                                name: "🛡️ Moderation",
                                value:
                                    "`/warn` `/warnings` `/clearwarnings` `/timeout` `/untimeout` `/kick` `/ban` `/unban`"
                            },

                            {
                                name: "🧹 Channel",
                                value:
                                    "`/purge` `/clear` `/lock` `/unlock` `/slowmode`"
                            },

                            {
                                name: "🎫 Support",
                                value:
                                    "`/ticket` `/close`"
                            },

                            {
                                name: "🔐 Security",
                                value:
                                    "Anti-spam, anti-mass-mention and anti-raid protection are automatic."
                            },

                            {
                                name: "⚙️ Configuration",
                                value:
                                    "`/setverify` `/setautorole`"
                            },

                            {
                                name: "📢 Staff",
                                value:
                                    "`/say` `/announce` `/staffcheck`"
                            }

                        )
                        .setTimestamp();

                return interaction.reply({
                    embeds: [embed],
                    ephemeral: true
                });
            }

            /* =========================================
               SERVER INFO
            ========================================= */

            if (
                command === "serverinfo"
            ) {

                const guild =
                    interaction.guild;

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            `🏠 ${guild.name}`
                        )
                        .addFields(

                            {
                                name: "👥 Members",
                                value:
                                    `${guild.memberCount}`,
                                inline: true
                            },

                            {
                                name: "📁 Channels",
                                value:
                                    `${guild.channels.cache.size}`,
                                inline: true
                            },

                            {
                                name: "🎭 Roles",
                                value:
                                    `${guild.roles.cache.size}`,
                                inline: true
                            },

                            {
                                name: "👑 Owner",
                                value:
                                    `<@${guild.ownerId}>`,
                                inline: true
                            },

                            {
                                name: "🆔 Server ID",
                                value:
                                    guild.id,
                                inline: true
                            }

                        )
                        .setTimestamp();

                return interaction.reply({
                    embeds: [embed]
                });
            }

            /* =========================================
               USER INFO
            ========================================= */

            if (
                command === "userinfo"
            ) {

                const user =
                    interaction.options.getUser(
                        "user"
                    ) ||
                    interaction.user;

                const member =
                    await interaction.guild.members
                        .fetch(user.id)
                        .catch(() => null);

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            "👤 User Information"
                        )
                        .setThumbnail(
                            user.displayAvatarURL({
                                size: 1024
                            })
                        )
                        .addFields(

                            {
                                name: "Username",
                                value:
                                    user.tag,
                                inline: true
                            },

                            {
                                name: "User ID",
                                value:
                                    user.id,
                                inline: true
                            },

                            {
                                name: "Bot",
                                value:
                                    user.bot
                                        ? "Yes"
                                        : "No",
                                inline: true
                            },

                            {
                                name: "Account Created",
                                value:
                                    `<t:${Math.floor(
                                        user.createdTimestamp /
                                            1000
                                    )}:F>`
                            },

                            {
                                name: "Joined Server",
                                value:
                                    member?.joinedTimestamp
                                        ? `<t:${Math.floor(
                                              member.joinedTimestamp /
                                                  1000
                                          )}:F>`
                                        : "Unknown"
                            }

                        )
                        .setTimestamp();

                return interaction.reply({
                    embeds: [embed]
                });
            }

            /* =========================================
               AVATAR
            ========================================= */

            if (
                command === "avatar"
            ) {

                const user =
                    interaction.options.getUser(
                        "user"
                    ) ||
                    interaction.user;

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            `${user.username}'s Avatar`
                        )
                        .setImage(
                            user.displayAvatarURL({
                                size: 2048
                            })
                        );

                return interaction.reply({
                    embeds: [embed]
                });
            }

            /* =========================================
               STAFF PERMISSION COMMANDS
            ========================================= */

            const staffCommands = [
                "warn",
                "warnings",
                "clearwarnings",
                "timeout",
                "untimeout",
                "kick",
                "ban",
                "unban",
                "purge",
                "clear",
                "lock",
                "unlock",
                "slowmode",
                "setverify",
                "setautorole",
                "say",
                "announce",
                "staffcheck"
            ];

            if (
                staffCommands.includes(command) &&
                !isSupportAdmin(
                    interaction.member
                )
            ) {

                return interaction.reply({
                    content:
                        "❌ You need the Support Admin role or Administrator permission.",
                    ephemeral: true
                });
            }

            /* =========================================
               WARN
            ========================================= */

            if (command === "warn") {

                const user =
                    interaction.options.getUser(
                        "user"
                    );

                const reason =
                    interaction.options.getString(
                        "reason"
                    ) ||
                    "No reason provided";

                if (
                    user.id ===
                    interaction.user.id
                ) {
                    return interaction.reply({
                        content:
                            "❌ You cannot warn yourself.",
                        ephemeral: true
                    });
                }

                const member =
                    await interaction.guild.members
                        .fetch(user.id)
                        .catch(() => null);

                if (
                    member &&
                    member.roles.highest.position >=
                        interaction.member.roles.highest
                            .position &&
                    !isOwner(
                        interaction.member
                    )
                ) {
                    return interaction.reply({
                        content:
                            "❌ You cannot moderate this member because of role hierarchy.",
                        ephemeral: true
                    });
                }

                const list =
                    addWarning(
                        interaction.guild.id,
                        user.id,
                        {
                            moderator:
                                interaction.user.id,
                            reason,
                            timestamp:
                                Date.now()
                        }
                    );

                await user.send(
                    `⚠️ You received a warning in **${interaction.guild.name}**.\nReason: ${reason}`
                ).catch(() => {});

                await sendLog(
                    interaction.guild,
                    "⚠️ Member Warned",
                    `**Member:** ${user}\n` +
                    `**Moderator:** ${interaction.user}\n` +
                    `**Reason:** ${reason}\n` +
                    `**Total warnings:** ${list.length}`
                );

                return interaction.reply(
                    `⚠️ ${user} has been warned. Total warnings: **${list.length}**.`
                );
            }

            /* =========================================
               WARNINGS
            ========================================= */

            if (
                command === "warnings"
            ) {

                const user =
                    interaction.options.getUser(
                        "user"
                    );

                const list =
                    getWarnings(
                        interaction.guild.id,
                        user.id
                    );

                if (!list.length) {

                    return interaction.reply(
                        `✅ ${user} has no warnings.`
                    );
                }

                const text =
                    list
                        .slice(-10)
                        .map(
                            (warning, index) =>
                                `**${index + 1}.** ${warning.reason}\n` +
                                `Moderator: <@${warning.moderator}>`
                        )
                        .join("\n\n");

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            `⚠️ Warnings — ${user.tag}`
                        )
                        .setDescription(
                            text
                        )
                        .setFooter({
                            text:
                                `Total warnings: ${list.length}`
                        })
                        .setTimestamp();

                return interaction.reply({
                    embeds: [embed]
                });
            }

            /* =========================================
               CLEAR WARNINGS
            ========================================= */

            if (
                command === "clearwarnings"
            ) {

                const user =
                    interaction.options.getUser(
                        "user"
                    );

                clearWarnings(
                    interaction.guild.id,
                    user.id
                );

                await sendLog(
                    interaction.guild,
                    "🧹 Warnings Cleared",
                    `**Member:** ${user}\n` +
                    `**Moderator:** ${interaction.user}`
                );

                return interaction.reply(
                    `✅ Warnings cleared for ${user}.`
                );
            }

            /* =========================================
               TIMEOUT
            ========================================= */

            if (
                command === "timeout"
            ) {

                const user =
                    interaction.options.getUser(
                        "user"
                    );

                const minutes =
                    interaction.options.getInteger(
                        "minutes"
                    );

                const reason =
                    interaction.options.getString(
                        "reason"
                    ) ||
                    "No reason provided";

                const member =
                    await interaction.guild.members
                        .fetch(user.id)
                        .catch(() => null);

                if (!member) {

                    return interaction.reply({
                        content:
                            "❌ Member not found.",
                        ephemeral: true
                    });
                }

                if (
                    !member.moderatable
                ) {

                    return interaction.reply({
                        content:
                            "❌ I cannot timeout this member. Check my role position.",
                        ephemeral: true
                    });
                }

                if (
                    member.id ===
                    interaction.user.id
                ) {

                    return interaction.reply({
                        content:
                            "❌ You cannot timeout yourself.",
                        ephemeral: true
                    });
                }

                await member.timeout(
                    minutes * 60 * 1000,
                    reason
                );

                await sendLog(
                    interaction.guild,
                    "⏱️ Member Timed Out",
                    `**Member:** ${user}\n` +
                    `**Duration:** ${minutes} minutes\n` +
                    `**Reason:** ${reason}\n` +
                    `**Moderator:** ${interaction.user}`
                );

                return interaction.reply(
                    `⏱️ ${user} has been timed out for **${minutes} minutes**.`
                );
            }

            /* =========================================
               UNTIMEOUT
            ========================================= */

            if (
                command === "untimeout"
            ) {

                const user =
                    interaction.options.getUser(
                        "user"
                    );

                const member =
                    await interaction.guild.members
                        .fetch(user.id)
                        .catch(() => null);

                if (!member) {
                    return interaction.reply(
                        "❌ Member not found."
                    );
                }

                if (
                    !member.moderatable
                ) {
                    return interaction.reply(
                        "❌ I cannot modify this member."
                    );
                }

                await member.timeout(
                    null,
                    "Timeout removed"
                );

                await sendLog(
                    interaction.guild,
                    "✅ Timeout Removed",
                    `**Member:** ${user}\n` +
                    `**Moderator:** ${interaction.user}`
                );

                return interaction.reply(
                    `✅ Timeout removed from ${user}.`
                );
            }

            /* =========================================
               KICK
            ========================================= */

            if (command === "kick") {

                const user =
                    interaction.options.getUser(
                        "user"
                    );

                const reason =
                    interaction.options.getString(
                        "reason"
                    ) ||
                    "No reason provided";

                const member =
                    await interaction.guild.members
                        .fetch(user.id)
                        .catch(() => null);

                if (
                    !member ||
                    !member.kickable
                ) {
                    return interaction.reply({
                        content:
                            "❌ I cannot kick this member.",
                        ephemeral: true
                    });
                }

                await member.kick(
                    reason
                );

                await sendLog(
                    interaction.guild,
                    "👢 Member Kicked",
                    `**Member:** ${user}\n` +
                    `**Reason:** ${reason}\n` +
                    `**Moderator:** ${interaction.user}`
                );

                return interaction.reply(
                    `👢 ${user.tag} has been kicked.`
                );
            }

            /* =========================================
               BAN
            ========================================= */

            if (command === "ban") {

                const user =
                    interaction.options.getUser(
                        "user"
                    );

                const reason =
                    interaction.options.getString(
                        "reason"
                    ) ||
                    "No reason provided";

                const member =
                    await interaction.guild.members
                        .fetch(user.id)
                        .catch(() => null);

                if (
                    member &&
                    !member.bannable
                ) {
                    return interaction.reply({
                        content:
                            "❌ I cannot ban this member.",
                        ephemeral: true
                    });
                }

                await interaction.guild.members.ban(
                    user.id,
                    {
                        reason
                    }
                );

                await sendLog(
                    interaction.guild,
                    "🔨 Member Banned",
                    `**Member:** ${user}\n` +
                    `**Reason:** ${reason}\n` +
                    `**Moderator:** ${interaction.user}`
                );

                return interaction.reply(
                    `🔨 ${user.tag} has been banned.`
                );
            }

            /* =========================================
               UNBAN
            ========================================= */

            if (command === "unban") {

                const userId =
                    interaction.options.getString(
                        "userid"
                    );

                try {

                    await interaction.guild.members.unban(
                        userId
                    );

                    await sendLog(
                        interaction.guild,
                        "✅ User Unbanned",
                        `**User ID:** ${userId}\n` +
                        `**Moderator:** ${interaction.user}`
                    );

                    return interaction.reply(
                        `✅ User **${userId}** has been unbanned.`
                    );

                } catch {

                    return interaction.reply({
                        content:
                            "❌ User is not banned or the ID is invalid.",
                        ephemeral: true
                    });
                }
            }

            /* =========================================
               PURGE / CLEAR
            ========================================= */

            if (
                command === "purge" ||
                command === "clear"
            ) {

                const amount =
                    interaction.options.getInteger(
                        "amount"
                    );

                if (
                    !interaction.channel ||
                    !interaction.channel.isTextBased()
                ) {
                    return interaction.reply({
                        content:
                            "❌ This command cannot be used here.",
                        ephemeral: true
                    });
                }

                const deleted =
                    await interaction.channel.bulkDelete(
                        amount,
                        true
                    );

                await interaction.reply({
                    content:
                        `🧹 Deleted **${deleted.size}** messages.`,
                    ephemeral: true
                });

                await sendLog(
                    interaction.guild,
                    "🧹 Messages Deleted",
                    `**Channel:** ${interaction.channel}\n` +
                    `**Amount:** ${deleted.size}\n` +
                    `**Moderator:** ${interaction.user}`
                );

                return;
            }

            /* =========================================
               LOCK
            ========================================= */

            if (command === "lock") {

                await interaction.channel.permissionOverwrites.edit(
                    interaction.guild.roles.everyone,
                    {
                        SendMessages: false
                    }
                );

                await sendLog(
                    interaction.guild,
                    "🔒 Channel Locked",
                    `**Channel:** ${interaction.channel}\n` +
                    `**Moderator:** ${interaction.user}`
                );

                return interaction.reply(
                    "🔒 Channel locked."
                );
            }

            /* =========================================
               UNLOCK
            ========================================= */

            if (command === "unlock") {

                await interaction.channel.permissionOverwrites.edit(
                    interaction.guild.roles.everyone,
                    {
                        SendMessages: null
                    }
                );

                await sendLog(
                    interaction.guild,
                    "🔓 Channel Unlocked",
                    `**Channel:** ${interaction.channel}\n` +
                    `**Moderator:** ${interaction.user}`
                );

                return interaction.reply(
                    "🔓 Channel unlocked."
                );
            }

            /* =========================================
               SLOWMODE
            ========================================= */

            if (
                command === "slowmode"
            ) {

                const seconds =
                    interaction.options.getInteger(
                        "seconds"
                    );

                await interaction.channel.setRateLimitPerUser(
                    seconds
                );

                return interaction.reply(
                    seconds === 0
                        ? "🐌 Slowmode disabled."
                        : `🐌 Slowmode set to **${seconds} seconds**.`
                );
            }

            /* =========================================
               TICKET
            ========================================= */

            if (command === "ticket") {

                const existing =
                    interaction.guild.channels.cache.find(
                        channel =>
                            channel.type ===
                                ChannelType.GuildText &&
                            channel.topic ===
                                `ticket-owner:${interaction.user.id}`
                    );

                if (existing) {

                    return interaction.reply({
                        content:
                            `🎫 You already have a ticket: ${existing}`,
                        ephemeral: true
                    });
                }

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            "🎫 Grand Mafia Support"
                        )
                        .setDescription(
                            "Click the button below to create a support ticket."
                        )
                        .setTimestamp();

                const row =
                    new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(
                                    "create_ticket"
                                )
                                .setLabel(
                                    "Create Ticket"
                                )
                                .setEmoji("🎫")
                                .setStyle(
                                    ButtonStyle.Primary
                                )
                        );

                return interaction.reply({
                    embeds: [embed],
                    components: [row]
                });
            }

            /* =========================================
               CLOSE
            ========================================= */

            if (command === "close") {

                const channel =
                    interaction.channel;

                if (
                    !channel ||
                    channel.type !==
                        ChannelType.GuildText
                ) {
                    return interaction.reply({
                        content:
                            "❌ This is not a ticket.",
                        ephemeral: true
                    });
                }

                const isTicket =
                    channel.topic &&
                    channel.topic.startsWith(
                        "ticket-owner:"
                    );

                if (!isTicket) {

                    return interaction.reply({
                        content:
                            "❌ This channel is not a ticket.",
                        ephemeral: true
                    });
                }

                const allowed =
                    isSupportAdmin(
                        interaction.member
                    ) ||
                    channel.topic ===
                        `ticket-owner:${interaction.user.id}`;

                if (!allowed) {

                    return interaction.reply({
                        content:
                            "❌ You cannot close this ticket.",
                        ephemeral: true
                    });
                }

                await interaction.reply(
                    "🔒 Closing ticket in 5 seconds..."
                );

                await sendLog(
                    interaction.guild,
                    "🔒 Ticket Closed",
                    `**Channel:** ${channel.name}\n` +
                    `**Closed by:** ${interaction.user}`
                );

                setTimeout(() => {

                    channel.delete(
                        "Ticket closed"
                    ).catch(() => {});

                }, 5000);

                return;
            }

            /* =========================================
               VERIFY
            ========================================= */

            if (command === "verify") {

                const roleId =
                    database.verifyRole[
                        interaction.guild.id
                    ];

                if (!roleId) {

                    return interaction.reply({
                        content:
                            "❌ Verification role has not been configured.",
                        ephemeral: true
                    });
                }

                const role =
                    interaction.guild.roles.cache.get(
                        roleId
                    );

                if (!role) {

                    return interaction.reply({
                        content:
                            "❌ Verification role no longer exists.",
                        ephemeral: true
                    });
                }

                if (
                    interaction.member.roles.cache.has(
                        role.id
                    )
                ) {

                    return interaction.reply({
                        content:
                            "✅ You are already verified.",
                        ephemeral: true
                    });
                }

                await interaction.member.roles.add(
                    role
                );

                return interaction.reply({
                    content:
                        "✅ Verification successful!",
                    ephemeral: true
                });
            }

            /* =========================================
               SET VERIFY
            ========================================= */

            if (
                command === "setverify"
            ) {

                const role =
                    interaction.options.getRole(
                        "role"
                    );

                if (
                    role.position >=
                    interaction.guild.members.me
                        .roles.highest.position
                ) {

                    return interaction.reply({
                        content:
                            "❌ My bot role must be higher than the verification role.",
                        ephemeral: true
                    });
                }

                database.verifyRole[
                    interaction.guild.id
                ] = role.id;

                saveDatabase();

                return interaction.reply(
                    `✅ Verification role set to ${role}.`
                );
            }

            /* =========================================
               SET AUTO ROLE
            ========================================= */

            if (
                command === "setautorole"
            ) {

                const role =
                    interaction.options.getRole(
                        "role"
                    );

                if (
                    role.position >=
                    interaction.guild.members.me
                        .roles.highest.position
                ) {

                    return interaction.reply({
                        content:
                            "❌ My bot role must be higher than the auto-role.",
                        ephemeral: true
                    });
                }

                database.autorole[
                    interaction.guild.id
                ] = role.id;

                saveDatabase();

                return interaction.reply(
                    `✅ Auto-role set to ${role}.`
                );
            }

            /* =========================================
               SAY
            ========================================= */

            if (command === "say") {

                const message =
                    interaction.options.getString(
                        "message"
                    );

                await interaction.channel.send(
                    message
                );

                return interaction.reply({
                    content:
                        "✅ Message sent.",
                    ephemeral: true
                });
            }

            /* =========================================
               ANNOUNCE
            ========================================= */

            if (
                command === "announce"
            ) {

                const message =
                    interaction.options.getString(
                        "message"
                    );

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            "📢 Announcement"
                        )
                        .setDescription(
                            message
                        )
                        .setTimestamp();

                await interaction.channel.send({
                    embeds: [embed]
                });

                await sendLog(
                    interaction.guild,
                    "📢 Announcement",
                    `**By:** ${interaction.user}\n\n${message}`
                );

                return interaction.reply({
                    content:
                        "✅ Announcement sent.",
                    ephemeral: true
                });
            }

            /* =========================================
               BOT INFO
            ========================================= */

            if (
                command === "botinfo"
            ) {

                const uptime =
                    formatDuration(
                        client.uptime || 0
                    );

                const memory =
                    process.memoryUsage();

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            "🤖 Bot Information"
                        )
                        .addFields(

                            {
                                name: "Bot",
                                value:
                                    client.user.tag,
                                inline: true
                            },

                            {
                                name: "Servers",
                                value:
                                    `${client.guilds.cache.size}`,
                                inline: true
                            },

                            {
                                name: "Ping",
                                value:
                                    `${client.ws.ping}ms`,
                                inline: true
                            },

                            {
                                name: "Uptime",
                                value:
                                    uptime,
                                inline: true
                            },

                            {
                                name: "Memory",
                                value:
                                    `${Math.round(
                                        memory.rss /
                                            1024 /
                                            1024
                                    )} MB`,
                                inline: true
                            },

                            {
                                name: "Discord.js",
                                value:
                                    require("discord.js")
                                        .version,
                                inline: true
                            }

                        )
                        .setTimestamp();

                return interaction.reply({
                    embeds: [embed]
                });
            }

            /* =========================================
               STAFF CHECK
            ========================================= */

            if (
                command === "staffcheck"
            ) {

                const hasRole =
                    interaction.member.roles.cache.has(
                        SUPPORT_ADMIN_ROLE_ID
                    );

                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle(
                                "🛡️ Staff Status"
                            )
                            .setDescription(
                                hasRole
                                    ? "✅ You have the Support Admin role."
                                    : "❌ You do not have the Support Admin role."
                            )
                            .setTimestamp()
                    ],
                    ephemeral: true
                });
            }

        } catch (error) {

            console.error(
                "Interaction error:",
                error
            );

            const response = {
                content:
                    "❌ An unexpected error occurred while processing this command.",
                ephemeral: true
            };

            if (
                interaction.replied ||
                interaction.deferred
            ) {

                await interaction.followUp(
                    response
                ).catch(() => {});

            } else {

                await interaction.reply(
                    response
                ).catch(() => {});
            }
        }
    }
);

/* =========================================================
   MEMBER JOIN
========================================================= */

client.on(
    "guildMemberAdd",
    async member => {

        try {

            /* =========================
               AUTO ROLE
            ========================= */

            const roleId =
                database.autorole[
                    member.guild.id
                ];

            if (roleId) {

                const role =
                    member.guild.roles.cache.get(
                        roleId
                    );

                if (
                    role &&
                    role.position <
                        member.guild.members.me
                            .roles.highest.position
                ) {

                    await member.roles.add(
                        role
                    ).catch(() => {});
                }
            }

            /* =========================
               JOIN LOG
            ========================= */

            await sendLog(
                member.guild,
                "📥 Member Joined",
                `**Member:** ${member.user}\n` +
                `**ID:** ${member.id}\n` +
                `**Account:** <t:${Math.floor(
                    member.user.createdTimestamp /
                        1000
                )}:R>`
            );

            /* =========================
               ANTI RAID
            ========================= */

            const guildId =
                member.guild.id;

            const now =
                Date.now();

            if (!joinTracker.has(guildId)) {
                joinTracker.set(
                    guildId,
                    []
                );
            }

            const joins =
                joinTracker.get(
                    guildId
                );

            joins.push(now);

            while (
                joins.length &&
                now - joins[0] >
                    10000
            ) {
                joins.shift();
            }

            /*
              10 joins within 10 seconds
              triggers raid warning.
            */

            if (
                joins.length >= 10
            ) {

                await sendLog(
                    member.guild,
                    "🚨 POSSIBLE RAID DETECTED",
                    `**${joins.length} members joined within 10 seconds.**\n\n` +
                    `Staff should immediately review the server.`
                );

                joinTracker.set(
                    guildId,
                    []
                );
            }

        } catch (error) {

            console.error(
                "Member join error:",
                error
            );
        }
    }
);

/* =========================================================
   MEMBER LEAVE
========================================================= */

client.on(
    "guildMemberRemove",
    async member => {

        await sendLog(
            member.guild,
            "📤 Member Left",
            `**Member:** ${member.user.tag}\n` +
            `**ID:** ${member.id}`
        );
    }
);

/* =========================================================
   MESSAGE CREATE
========================================================= */

client.on(
    "messageCreate",
    async message => {

        try {

            if (!message.guild) return;

            if (message.author.bot) {
                return;
            }

            const member =
                message.member;

            /* =====================================
               ADMIN BYPASS
            ===================================== */

            if (
                member &&
                (
                    member.permissions.has(
                        PermissionsBitField.Flags.Administrator
                    ) ||
                    member.roles.cache.has(
                        SUPPORT_ADMIN_ROLE_ID
                    )
                )
            ) {
                return;
            }

            /* =====================================
               MASS MENTION PROTECTION
            ===================================== */

            const mentionCount =
                message.mentions.users.size +
                message.mentions.roles.size;

            if (
                message.mentions.everyone ||
                mentionCount >= 5
            ) {

                await message.delete()
                    .catch(() => {});

                if (
                    member &&
                    member.moderatable
                ) {

                    await member.timeout(
                        5 * 60 * 1000,
                        "Automatic mass mention protection"
                    ).catch(() => {});

                    await sendLog(
                        message.guild,
                        "🚨 Mass Mention Protection",
                        `**User:** ${message.author}\n` +
                        `**Mentions:** ${mentionCount}\n` +
                        `**Action:** Automatic timeout`
                    );
                }

                return;
            }

            /* =====================================
               SPAM PROTECTION
            ===================================== */

            const userId =
                message.author.id;

            if (!spamTracker.has(userId)) {
                spamTracker.set(
                    userId,
                    []
                );
            }

            const messages =
                spamTracker.get(
                    userId
                );

            const now =
                Date.now();

            messages.push({
                timestamp: now,
                channel:
                    message.channel.id
            });

            while (
                messages.length &&
                now -
                    messages[0].timestamp >
                    5000
            ) {
                messages.shift();
            }

            /*
               6 messages in 5 seconds
               = spam.
            */

            if (
                messages.length >= 6
            ) {

                spamTracker.set(
                    userId,
                    []
                );

                await message.delete()
                    .catch(() => {});

                if (
                    member &&
                    member.moderatable
                ) {

                    await member.timeout(
                        60 * 1000,
                        "Automatic anti-spam protection"
                    ).catch(() => {});

                    await sendLog(
                        message.guild,
                        "🛡️ Anti-Spam Triggered",
                        `**User:** ${message.author}\n` +
                        `**Action:** 1 minute automatic timeout`
                    );
                }

                return;
            }

        } catch (error) {

            console.error(
                "Message protection error:",
                error
            );
        }
    }
);

/* =========================================================
   MESSAGE DELETE LOG
========================================================= */

client.on(
    "messageDelete",
    async message => {

        if (!message.guild) return;

        if (message.author?.bot) {
            return;
        }

        await sendLog(
            message.guild,
            "🗑️ Message Deleted",
            `**Author:** ${
                message.author || "Unknown"
            }\n` +
            `**Channel:** ${message.channel}\n` +
            `**Content:** ${
                message.content || "Content unavailable"
            }`
        );
    }
);

/* =========================================================
   MESSAGE EDIT LOG
========================================================= */

client.on(
    "messageUpdate",
    async (oldMessage, newMessage) => {

        if (!oldMessage.guild) return;

        if (
            oldMessage.author?.bot
        ) {
            return;
        }

        if (
            oldMessage.content ===
            newMessage.content
        ) {
            return;
        }

        await sendLog(
            oldMessage.guild,
            "✏️ Message Edited",
            `**Author:** ${
                oldMessage.author ||
                "Unknown"
            }\n` +
            `**Channel:** ${oldMessage.channel}\n\n` +
            `**Before:** ${
                oldMessage.content ||
                "Unavailable"
            }\n\n` +
            `**After:** ${
                newMessage.content ||
                "Unavailable"
            }`
        );
    }
);

/* =========================================================
   ERROR HANDLING
========================================================= */

client.on(
    "error",
    error => {
        console.error(
            "Discord client error:",
            error
        );
    }
);

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "Unhandled promise rejection:",
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

/* =========================================================
   START BOT
========================================================= */

async function startBot() {

    await registerCommands();

    await client.login(
        TOKEN
    );
}

startBot();
