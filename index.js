const {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionsBitField,
    ChannelType,
    EmbedBuilder,
    SlashCommandBuilder,
    REST,
    Routes
} = require("discord.js");

const { Pool } = require("pg");

// ======================================================
// ENVIRONMENT
// ======================================================

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

if (!DATABASE_URL) {
    console.error("❌ DATABASE_URL is missing from environment variables.");
    process.exit(1);
}

// ======================================================
// POSTGRESQL
// ======================================================

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function database() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS warnings (
                id SERIAL PRIMARY KEY,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                moderator_id TEXT NOT NULL,
                reason TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS bot_settings (
                guild_id TEXT PRIMARY KEY,
                log_channel TEXT,
                welcome_channel TEXT,
                welcome_message TEXT,
                autorole_id TEXT,
                verification_role TEXT
            );

            CREATE TABLE IF NOT EXISTS user_activity (
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                messages INTEGER DEFAULT 0,
                voice_minutes INTEGER DEFAULT 0,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (guild_id, user_id)
            );
        `);

        console.log("✅ PostgreSQL database connected");
    } catch (error) {
        console.error("❌ PostgreSQL connection failed:", error.message);
    }
}

database();

// ======================================================
// CLIENT
// ======================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [
        Partials.Channel,
        Partials.Message,
        Partials.GuildMember,
        Partials.User
    ]
});

// ======================================================
// COMMAND HELPER
// ======================================================

const commands = [];

function command(name, description, options = []) {
    const cmd = new SlashCommandBuilder()
        .setName(name)
        .setDescription(description);

    for (const option of options) {
        if (option.type === "string") {
            cmd.addStringOption(o => {
                o.setName(option.name)
                    .setDescription(option.description)
                    .setRequired(option.required ?? false);

                if (option.choices) {
                    o.addChoices(...option.choices);
                }

                return o;
            });
        }

        if (option.type === "user") {
            cmd.addUserOption(o =>
                o.setName(option.name)
                    .setDescription(option.description)
                    .setRequired(option.required ?? false)
            );
        }

        if (option.type === "integer") {
            cmd.addIntegerOption(o =>
                o.setName(option.name)
                    .setDescription(option.description)
                    .setRequired(option.required ?? false)
            );
        }

        if (option.type === "channel") {
            cmd.addChannelOption(o =>
                o.setName(option.name)
                    .setDescription(option.description)
                    .setRequired(option.required ?? false)
            );
        }

        if (option.type === "role") {
            cmd.addRoleOption(o =>
                o.setName(option.name)
                    .setDescription(option.description)
                    .setRequired(option.required ?? false)
            );
        }
    }

    commands.push(cmd);
}

// ======================================================
// 75+ COMMANDS
// ======================================================

// Moderation
command("ban", "Ban a member.", [
    { type: "user", name: "user", description: "Member to ban", required: true },
    { type: "string", name: "reason", description: "Reason" }
]);

command("unban", "Unban a user.", [
    { type: "string", name: "userid", description: "User ID", required: true }
]);

command("kick", "Kick a member.", [
    { type: "user", name: "user", description: "Member", required: true },
    { type: "string", name: "reason", description: "Reason" }
]);

command("timeout", "Timeout a member.", [
    { type: "user", name: "user", description: "Member", required: true },
    { type: "integer", name: "minutes", description: "Minutes", required: true },
    { type: "string", name: "reason", description: "Reason" }
]);

command("untimeout", "Remove a timeout.", [
    { type: "user", name: "user", description: "Member", required: true }
]);

command("warn", "Warn a member.", [
    { type: "user", name: "user", description: "Member", required: true },
    { type: "string", name: "reason", description: "Reason", required: true }
]);

command("warnings", "View member warnings.", [
    { type: "user", name: "user", description: "Member", required: true }
]);

command("clearwarnings", "Clear member warnings.", [
    { type: "user", name: "user", description: "Member", required: true }
]);

command("purge", "Delete messages.", [
    { type: "integer", name: "amount", description: "Amount", required: true }
]);

command("lock", "Lock a channel.");
command("unlock", "Unlock a channel.");
command("slowmode", "Set channel slowmode.", [
    { type: "integer", name: "seconds", description: "Seconds", required: true }
]);

command("nick", "Change a member nickname.", [
    { type: "user", name: "user", description: "Member", required: true },
    { type: "string", name: "nickname", description: "Nickname", required: true }
]);

command("softban", "Softban a member.", [
    { type: "user", name: "user", description: "Member", required: true }
]);

// Server
command("serverinfo", "Show server information.");
command("userinfo", "Show user information.", [
    { type: "user", name: "user", description: "User" }
]);

command("avatar", "Show a user's avatar.", [
    { type: "user", name: "user", description: "User" }
]);

command("roleinfo", "Show role information.", [
    { type: "role", name: "role", description: "Role", required: true }
]);

command("channelinfo", "Show channel information.");
command("membercount", "Show member count.");
command("botinfo", "Show bot information.");
command("ping", "Show bot latency.");
command("uptime", "Show bot uptime.");
command("help", "Show bot commands.");

// Role management
command("addrole", "Give a role to a member.", [
    { type: "user", name: "user", description: "Member", required: true },
    { type: "role", name: "role", description: "Role", required: true }
]);

command("removerole", "Remove a role.", [
    { type: "user", name: "user", description: "Member", required: true },
    { type: "role", name: "role", description: "Role", required: true }
]);

command("createrole", "Create a role.", [
    { type: "string", name: "name", description: "Role name", required: true }
]);

command("deleterole", "Delete a role.", [
    { type: "role", name: "role", description: "Role", required: true }
]);

// Channels
command("createchannel", "Create a text channel.", [
    { type: "string", name: "name", description: "Channel name", required: true }
]);

command("deletechannel", "Delete current channel.");
command("renamechannel", "Rename current channel.", [
    { type: "string", name: "name", description: "New name", required: true }
]);

// Configuration
command("setlog", "Set logging channel.", [
    { type: "channel", name: "channel", description: "Log channel", required: true }
]);

command("setwelcome", "Set welcome channel.", [
    { type: "channel", name: "channel", description: "Welcome channel", required: true }
]);

command("setautorole", "Set automatic member role.", [
    { type: "role", name: "role", description: "Role", required: true }
]);

command("setverification", "Set verification role.", [
    { type: "role", name: "role", description: "Role", required: true }
]);

command("settings", "View bot settings.");

// Security
command("security", "Show security status.");
command("antiraid", "Configure anti-raid.");
command("antispam", "Configure anti-spam.");
command("antibot", "Configure anti-bot.");
command("antimassban", "Configure anti mass-ban.");
command("antimassmention", "Configure anti mass-mention.");
command("automod", "Show auto moderation.");
command("automod-enable", "Enable auto moderation.");
command("automod-disable", "Disable auto moderation.");

// Tickets
command("ticket", "Create a support ticket.");
command("close", "Close the current ticket.");
command("addmember", "Add member to ticket.", [
    { type: "user", name: "user", description: "Member", required: true }
]);

command("removemember", "Remove member from ticket.", [
    { type: "user", name: "user", description: "Member", required: true }
]);

command("ticketpanel", "Create ticket panel.");

// Verification
command("verify", "Verify yourself.");
command("verificationpanel", "Create verification panel.");

// Invites
command("invites", "Show user invites.", [
    { type: "user", name: "user", description: "User" }
]);

command("inviteleaderboard", "Show invite leaderboard.");
command("invitereset", "Reset invite data.", [
    { type: "user", name: "user", description: "User", required: true }
]);

// Activity
command("activity", "Show member activity.", [
    { type: "user", name: "user", description: "User" }
]);

command("activityleaderboard", "Show activity leaderboard.");
command("staffactivity", "Show staff activity.");
command("staffreport", "Generate staff activity report.");

// Logging
command("logs", "Show logging status.");
command("audit", "Show recent audit information.");
command("modlogs", "Show moderation logs.", [
    { type: "user", name: "user", description: "User" }
]);

// Utility
command("say", "Make the bot send a message.", [
    { type: "string", name: "message", description: "Message", required: true }
]);

command("embed", "Send an embed message.", [
    { type: "string", name: "title", description: "Title", required: true },
    { type: "string", name: "message", description: "Message", required: true }
]);

command("announce", "Send an announcement.", [
    { type: "string", name: "message", description: "Announcement", required: true }
]);

command("poll", "Create a simple poll.", [
    { type: "string", name: "question", description: "Question", required: true }
]);

command("remind", "Create a reminder.", [
    { type: "integer", name: "minutes", description: "Minutes", required: true },
    { type: "string", name: "message", description: "Reminder", required: true }
]);

command("8ball", "Ask the magic 8-ball.", [
    { type: "string", name: "question", description: "Question", required: true }
]);

command("choose", "Choose between options.", [
    { type: "string", name: "options", description: "Separate options with commas", required: true }
]);

command("roll", "Roll a dice.");
command("coinflip", "Flip a coin.");
command("random", "Generate a random number.", [
    { type: "integer", name: "max", description: "Maximum", required: true }
]);

// RP commands
command("rpinfo", "Show RP server information.");
command("rules", "Show server rules.");
command("factions", "Show factions.");
command("jobs", "Show RP jobs.");
command("report", "Submit a player report.", [
    { type: "user", name: "user", description: "Reported user", required: true },
    { type: "string", name: "reason", description: "Reason", required: true }
]);

command("suggest", "Submit a suggestion.", [
    { type: "string", name: "suggestion", description: "Suggestion", required: true }
]);

command("apply", "Open a staff application.");
command("staffinfo", "Show staff information.");
command("rules-staff", "Show staff rules.");

// Extra management
command("maintenance", "Toggle maintenance mode.");
command("broadcast", "Broadcast a server message.", [
    { type: "string", name: "message", description: "Message", required: true }
]);

command("setstatus", "Change bot status.", [
    { type: "string", name: "status", description: "Status", required: true }
]);

command("reload", "Reload bot configuration.");
command("database", "Check database status.");
command("stats", "Show bot statistics.");
command("permissions", "Check your permissions.");

// ======================================================
// REGISTER COMMANDS
// ======================================================

async function registerCommands() {
    try {
        const rest = new REST({ version: "10" }).setToken(TOKEN);

        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands.map(command => command.toJSON()) }
        );

        console.log(`✅ ${commands.length} slash commands registered.`);
    } catch (error) {
        console.error("❌ Slash command registration failed:", error.message);
    }
}

// ======================================================
// PERMISSION CHECK
// ======================================================

function isAdmin(interaction) {
    return interaction.member?.permissions?.has(
        PermissionsBitField.Flags.Administrator
    );
}

function reply(interaction, content, ephemeral = true) {
    return interaction.reply({
        content,
        ephemeral
    });
}

// ======================================================
// READY
// ======================================================

client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    console.log(`🌐 Serving ${client.guilds.cache.size} server(s)`);
    console.log(`📦 Loaded ${commands.length} commands`);

    client.user.setPresence({
        activities: [
            {
                name: "Grand Mafia RP",
                type: 0
            }
        ],
        status: "online"
    });

    await registerCommands();
});

// ======================================================
// MEMBER JOIN
// ======================================================

client.on("guildMemberAdd", async member => {
    try {
        const result = await pool.query(
            "SELECT welcome_channel, autorole_id FROM bot_settings WHERE guild_id = $1",
            [member.guild.id]
        );

        const settings = result.rows[0];

        if (settings?.autorole_id) {
            const role = member.guild.roles.cache.get(settings.autorole_id);

            if (role && role.editable) {
                await member.roles.add(role).catch(() => {});
            }
        }

        if (settings?.welcome_channel) {
            const channel = member.guild.channels.cache.get(
                settings.welcome_channel
            );

            if (channel) {
                await channel.send(
                    `👋 Welcome ${member} to **${member.guild.name}**!`
                ).catch(() => {});
            }
        }
    } catch {}
});

// ======================================================
// MESSAGE ACTIVITY
// ======================================================

client.on("messageCreate", async message => {
    if (!message.guild || message.author.bot) return;

    try {
        await pool.query(`
            INSERT INTO user_activity
            (guild_id, user_id, messages, last_seen)
            VALUES ($1, $2, 1, CURRENT_TIMESTAMP)
            ON CONFLICT (guild_id, user_id)
            DO UPDATE SET
                messages = user_activity.messages + 1,
                last_seen = CURRENT_TIMESTAMP
        `, [
            message.guild.id,
            message.author.id
        ]);
    } catch {}
});

// ======================================================
// INTERACTIONS
// ======================================================

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const name = interaction.commandName;

    // -------------------------------
    // BASIC
    // -------------------------------

    if (name === "ping") {
        return interaction.reply(
            `🏓 Pong! ${client.ws.ping}ms`
        );
    }

    if (name === "uptime") {
        const seconds = Math.floor(process.uptime());
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        return interaction.reply(
            `⏱️ Uptime: **${hours}h ${minutes}m ${secs}s**`
        );
    }

    if (name === "botinfo") {
        const embed = new EmbedBuilder()
            .setTitle("🤖 Bot Information")
            .addFields(
                {
                    name: "Bot",
                    value: client.user.tag,
                    inline: true
                },
                {
                    name: "Servers",
                    value: `${client.guilds.cache.size}`,
                    inline: true
                },
                {
                    name: "Commands",
                    value: `${commands.length}`,
                    inline: true
                }
            );

        return interaction.reply({ embeds: [embed] });
    }

    if (name === "database") {
        try {
            await pool.query("SELECT NOW()");
            return interaction.reply("🟢 PostgreSQL database is online.");
        } catch {
            return interaction.reply("🔴 PostgreSQL database is offline.");
        }
    }

    // -------------------------------
    // SERVER INFO
    // -------------------------------

    if (name === "serverinfo") {
        const guild = interaction.guild;

        const embed = new EmbedBuilder()
            .setTitle(`📊 ${guild.name}`)
            .addFields(
                {
                    name: "Members",
                    value: `${guild.memberCount}`,
                    inline: true
                },
                {
                    name: "Channels",
                    value: `${guild.channels.cache.size}`,
                    inline: true
                },
                {
                    name: "Roles",
                    value: `${guild.roles.cache.size}`,
                    inline: true
                }
            );

        return interaction.reply({ embeds: [embed] });
    }

    if (name === "membercount") {
        return interaction.reply(
            `👥 Members: **${interaction.guild.memberCount}**`
        );
    }

    // -------------------------------
    // USER INFO
    // -------------------------------

    if (name === "userinfo") {
        const user =
            interaction.options.getUser("user") ||
            interaction.user;

        const member = await interaction.guild.members
            .fetch(user.id)
            .catch(() => null);

        const embed = new EmbedBuilder()
            .setTitle(`👤 ${user.username}`)
            .setThumbnail(user.displayAvatarURL())
            .addFields(
                {
                    name: "ID",
                    value: user.id
                },
                {
                    name: "Joined",
                    value: member
                        ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
                        : "Unknown"
                }
            );

        return interaction.reply({ embeds: [embed] });
    }

    if (name === "avatar") {
        const user =
            interaction.options.getUser("user") ||
            interaction.user;

        return interaction.reply(
            user.displayAvatarURL({ size: 1024 })
        );
    }

    // -------------------------------
    // MODERATION
    // -------------------------------

    if (
        [
            "ban",
            "unban",
            "kick",
            "timeout",
            "untimeout",
            "warn",
            "clearwarnings",
            "purge",
            "lock",
            "unlock",
            "slowmode",
            "nick",
            "softban",
            "addrole",
            "removerole",
            "createrole",
            "deleterole",
            "createchannel",
            "deletechannel",
            "renamechannel"
        ].includes(name)
    ) {
        if (!isAdmin(interaction)) {
            return reply(
                interaction,
                "❌ You need **Administrator** permission."
            );
        }
    }

    if (name === "ban") {
        const user = interaction.options.getUser("user");
        const reason =
            interaction.options.getString("reason") || "No reason provided";

        const member = await interaction.guild.members
            .fetch(user.id)
            .catch(() => null);

        if (!member) {
            return reply(interaction, "❌ Member not found.");
        }

        try {
            await member.ban({ reason });
            return reply(
                interaction,
                `🔨 **${user.tag}** has been banned.\nReason: ${reason}`
            );
        } catch {
            return reply(interaction, "❌ I couldn't ban this member.");
        }
    }

    if (name === "kick") {
        const user = interaction.options.getUser("user");
        const reason =
            interaction.options.getString("reason") || "No reason provided";

        const member = await interaction.guild.members
            .fetch(user.id)
            .catch(() => null);

        if (!member) {
            return reply(interaction, "❌ Member not found.");
        }

        try {
            await member.kick(reason);

            return reply(
                interaction,
                `👢 **${user.tag}** has been kicked.\nReason: ${reason}`
            );
        } catch {
            return reply(interaction, "❌ I couldn't kick this member.");
        }
    }

    if (name === "timeout") {
        const user = interaction.options.getUser("user");
        const minutes = interaction.options.getInteger("minutes");
        const reason =
            interaction.options.getString("reason") || "No reason provided";

        if (minutes < 1 || minutes > 40320) {
            return reply(
                interaction,
                "❌ Timeout must be between 1 and 40320 minutes."
            );
        }

        const member = await interaction.guild.members
            .fetch(user.id)
            .catch(() => null);

        if (!member) {
            return reply(interaction, "❌ Member not found.");
        }

        try {
            await member.timeout(minutes * 60 * 1000, reason);

            return reply(
                interaction,
                `⏱️ **${user.tag}** timed out for **${minutes} minutes**.\nReason: ${reason}`
            );
        } catch {
            return reply(interaction, "❌ I couldn't timeout this member.");
        }
    }

    if (name === "untimeout") {
        const user = interaction.options.getUser("user");

        const member = await interaction.guild.members
            .fetch(user.id)
            .catch(() => null);

        if (!member) {
            return reply(interaction, "❌ Member not found.");
        }

        try {
            await member.timeout(null);

            return reply(
                interaction,
                `✅ Timeout removed from **${user.tag}**.`
            );
        } catch {
            return reply(interaction, "❌ I couldn't remove the timeout.");
        }
    }

    if (name === "warn") {
        const user = interaction.options.getUser("user");
        const reason = interaction.options.getString("reason");

        await pool.query(`
            INSERT INTO warnings
            (guild_id, user_id, moderator_id, reason)
            VALUES ($1, $2, $3, $4)
        `, [
            interaction.guild.id,
            user.id,
            interaction.user.id,
            reason
        ]);

        return reply(
            interaction,
            `⚠️ **${user.tag}** has been warned.\nReason: ${reason}`
        );
    }

    if (name === "warnings") {
        const user = interaction.options.getUser("user");

        const result = await pool.query(`
            SELECT reason, moderator_id, created_at
            FROM warnings
            WHERE guild_id = $1 AND user_id = $2
            ORDER BY created_at DESC
        `, [
            interaction.guild.id,
            user.id
        ]);

        if (!result.rows.length) {
            return reply(
                interaction,
                `✅ **${user.tag}** has no warnings.`
            );
        }

        const text = result.rows
            .slice(0, 10)
            .map(
                (w, i) =>
                    `**${i + 1}.** ${w.reason} — <@${w.moderator_id}>`
            )
            .join("\n");

        return reply(
            interaction,
            `⚠️ Warnings for **${user.tag}**:\n\n${text}`
        );
    }

    if (name === "clearwarnings") {
        const user = interaction.options.getUser("user");

        await pool.query(`
            DELETE FROM warnings
            WHERE guild_id = $1 AND user_id = $2
        `, [
            interaction.guild.id,
            user.id
        ]);

        return reply(
            interaction,
            `✅ Warnings cleared for **${user.tag}**.`
        );
    }

    // -------------------------------
    // ACTIVITY
    // -------------------------------

    if (name === "activity") {
        const user =
            interaction.options.getUser("user") ||
            interaction.user;

        const result = await pool.query(`
            SELECT messages, voice_minutes, last_seen
            FROM user_activity
            WHERE guild_id = $1 AND user_id = $2
        `, [
            interaction.guild.id,
            user.id
        ]);

        const data = result.rows[0];

        if (!data) {
            return reply(
                interaction,
                `📊 No activity recorded for **${user.tag}** yet.`
            );
        }

        return reply(
            interaction,
            `📊 **${user.tag} Activity**\n\n` +
            `💬 Messages: **${data.messages}**\n` +
            `🎙️ Voice minutes: **${data.voice_minutes}**\n` +
            `🕐 Last seen: <t:${Math.floor(new Date(data.last_seen).getTime() / 1000)}:R>`
        );
    }

    // -------------------------------
    // ROLE
    // -------------------------------

    if (name === "addrole") {
        const user = interaction.options.getUser("user");
        const role = interaction.options.getRole("role");

        const member = await interaction.guild.members
            .fetch(user.id)
            .catch(() => null);

        if (!member || !role) {
            return reply(interaction, "❌ Member or role not found.");
        }

        try {
            await member.roles.add(role);
            return reply(
                interaction,
                `✅ Added ${role} to **${user.tag}**.`
            );
        } catch {
            return reply(interaction, "❌ I couldn't add that role.");
        }
    }

    if (name === "removerole") {
        const user = interaction.options.getUser("user");
        const role = interaction.options.getRole("role");

        const member = await interaction.guild.members
            .fetch(user.id)
            .catch(() => null);

        if (!member || !role) {
            return reply(interaction, "❌ Member or role not found.");
        }

        try {
            await member.roles.remove(role);
            return reply(
                interaction,
                `✅ Removed ${role} from **${user.tag}**.`
            );
        } catch {
            return reply(interaction, "❌ I couldn't remove that role.");
        }
    }

    // -------------------------------
    // UTILITY
    // -------------------------------

    if (name === "roll") {
        const number = Math.floor(Math.random() * 6) + 1;
        return interaction.reply(`🎲 You rolled **${number}**.`);
    }

    if (name === "coinflip") {
        return interaction.reply(
            Math.random() >= 0.5
                ? "🪙 **Heads!**"
                : "🪙 **Tails!**"
        );
    }

    if (name === "random") {
        const max = interaction.options.getInteger("max");

        if (max < 1) {
            return reply(interaction, "❌ Maximum must be at least 1.");
        }

        return interaction.reply(
            `🎲 Random number: **${Math.floor(Math.random() * max) + 1}**`
        );
    }

    if (name === "choose") {
        const options =
            interaction.options.getString("options")
                .split(",")
                .map(x => x.trim())
                .filter(Boolean);

        if (!options.length) {
            return reply(interaction, "❌ No options provided.");
        }

        const selected =
            options[Math.floor(Math.random() * options.length)];

        return interaction.reply(
            `🎯 I choose: **${selected}**`
        );
    }

    if (name === "8ball") {
        const answers = [
            "Yes.",
            "No.",
            "Definitely.",
            "Probably.",
            "Ask again later.",
            "I don't think so.",
            "Absolutely.",
            "Maybe."
        ];

        return interaction.reply(
            `🎱 ${answers[Math.floor(Math.random() * answers.length)]}`
        );
    }

    if (name === "help") {
        const embed = new EmbedBuilder()
            .setTitle("🤖 Grand Mafia RP Bot")
            .setDescription(
                `This bot currently has **${commands.length} slash commands**.\n\n` +
                `🛡️ Moderation\n` +
                `🔐 Security\n` +
                `🎫 Tickets\n` +
                `📊 Activity\n` +
                `⚙️ Server Management\n` +
                `🎮 RP Tools\n` +
                `🧰 Utilities`
            );

        return interaction.reply({ embeds: [embed] });
    }

    // -------------------------------
    // SETTINGS
    // -------------------------------

    if (
        [
            "setlog",
            "setwelcome",
            "setautorole",
            "setverification"
        ].includes(name)
    ) {
        if (!isAdmin(interaction)) {
            return reply(
                interaction,
                "❌ You need **Administrator** permission."
            );
        }

        let column;
        let value;

        if (name === "setlog") {
            column = "log_channel";
            value = interaction.options.getChannel("channel").id;
        }

        if (name === "setwelcome") {
            column = "welcome_channel";
            value = interaction.options.getChannel("channel").id;
        }

        if (name === "setautorole") {
            column = "autorole_id";
            value = interaction.options.getRole("role").id;
        }

        if (name === "setverification") {
            column = "verification_role";
            value = interaction.options.getRole("role").id;
        }

        await pool.query(`
            INSERT INTO bot_settings (guild_id, ${column})
            VALUES ($1, $2)
            ON CONFLICT (guild_id)
            DO UPDATE SET ${column} = EXCLUDED.${column}
        `, [
            interaction.guild.id,
            value
        ]);

        return reply(
            interaction,
            `✅ ${column} has been configured.`
        );
    }

    if (name === "settings") {
        const result = await pool.query(
            "SELECT * FROM bot_settings WHERE guild_id = $1",
            [interaction.guild.id]
        );

        const s = result.rows[0];

        if (!s) {
            return reply(
                interaction,
                "⚙️ No settings configured yet."
            );
        }

        return reply(
            interaction,
            `⚙️ **Server Settings**\n\n` +
            `📝 Log: ${s.log_channel ? `<#${s.log_channel}>` : "Not set"}\n` +
            `👋 Welcome: ${s.welcome_channel ? `<#${s.welcome_channel}>` : "Not set"}\n` +
            `🎭 Auto Role: ${s.autorole_id ? `<@&${s.autorole_id}>` : "Not set"}\n` +
            `✅ Verification: ${s.verification_role ? `<@&${s.verification_role}>` : "Not set"}`
        );
    }

    // -------------------------------
    // PLACEHOLDER SYSTEM COMMANDS
    // -------------------------------

    const comingSoon = [
        "lock",
        "unlock",
        "slowmode",
        "nick",
        "softban",
        "purge",
        "unban",
        "createrole",
        "deleterole",
        "createchannel",
        "deletechannel",
        "renamechannel",
        "security",
        "antiraid",
        "antispam",
        "antibot",
        "antimassban",
        "antimassmention",
        "automod",
        "automod-enable",
        "automod-disable",
        "ticket",
        "close",
        "addmember",
        "removemember",
        "ticketpanel",
        "verify",
        "verificationpanel",
        "invites",
        "inviteleaderboard",
        "invitereset",
        "activityleaderboard",
        "staffactivity",
        "staffreport",
        "logs",
        "audit",
        "modlogs",
        "say",
        "embed",
        "announce",
        "poll",
        "remind",
        "rpinfo",
        "rules",
        "factions",
        "jobs",
        "report",
        "suggest",
        "apply",
        "staffinfo",
        "rules-staff",
        "maintenance",
        "broadcast",
        "setstatus",
        "reload",
        "stats",
        "permissions",
        "roleinfo",
        "channelinfo"
    ];

    if (comingSoon.includes(name)) {
        return reply(
            interaction,
            `🛠️ **/${name}** is registered and ready for the next module.`
        );
    }
});

// ======================================================
// ERROR HANDLING
// ======================================================

process.on("unhandledRejection", error => {
    console.error("❌ Unhandled rejection:", error);
});

process.on("uncaughtException", error => {
    console.error("❌ Uncaught exception:", error);
});

// ======================================================
// LOGIN
// ======================================================

client.login(TOKEN);
