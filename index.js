require("dotenv").config();

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
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  AttachmentBuilder
} = require("discord.js");
const { Pool } = require("pg");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const DATABASE_URL = process.env.DATABASE_URL;
const DEFAULT_GUILD_ID = process.env.DEFAULT_GUILD_ID || "";

if (!TOKEN || !CLIENT_ID || !DATABASE_URL) {
  console.error("Missing DISCORD_TOKEN, CLIENT_ID or DATABASE_URL in .env");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

const commands = [
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Create a support ticket (also usable in DM)."),
  new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription("Send the ticket panel.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild.toString()),
  new SlashCommandBuilder()
    .setName("ticketsetup")
    .setDescription("Configure the ticket system.")
    .addSubcommand(s => s.setName("category").setDescription("Set the ticket category channel.")
      .addChannelOption(o => o.setName("channel").setDescription("Category channel").setRequired(true)
        .addChannelTypes(ChannelType.GuildCategory)))
    .addSubcommand(s => s.setName("staffrole").setDescription("Set the ticket staff role.")
      .addRoleOption(o => o.setName("role").setDescription("Staff role").setRequired(true)))
    .addSubcommand(s => s.setName("logs").setDescription("Set the ticket log channel.")
      .addChannelOption(o => o.setName("channel").setDescription("Log channel").setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand(s => s.setName("transcripts").setDescription("Set the transcript channel.")
      .addChannelOption(o => o.setName("channel").setDescription("Transcript channel").setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand(s => s.setName("limit").setDescription("Set maximum open tickets per user.")
      .addIntegerOption(o => o.setName("amount").setDescription("1-20").setRequired(true).setMinValue(1).setMaxValue(20)))
    .addSubcommand(s => s.setName("cleanup").setDescription("Set automatic closed-ticket cleanup time.")
      .addIntegerOption(o => o.setName("minutes").setDescription("0 disables cleanup; minimum 5").setRequired(true).setMinValue(0).setMaxValue(43200)))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild.toString()),
  new SlashCommandBuilder()
    .setName("ticketcategory")
    .setDescription("Manage ticket categories.")
    .addSubcommand(s => s.setName("add").setDescription("Add a category.")
      .addStringOption(o => o.setName("name").setDescription("Category name").setRequired(true).setMaxLength(80))
      .addStringOption(o => o.setName("emoji").setDescription("Emoji").setRequired(false).setMaxLength(10)))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a category.")
      .addStringOption(o => o.setName("name").setDescription("Category name").setRequired(true)))
    .addSubcommand(s => s.setName("list").setDescription("List ticket categories."))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild.toString()),
  new SlashCommandBuilder()
    .setName("close").setDescription("Close the current ticket.")
    .addStringOption(o => o.setName("reason").setDescription("Close reason").setRequired(false).setMaxLength(500)),
  new SlashCommandBuilder().setName("claim").setDescription("Claim the current ticket."),
  new SlashCommandBuilder().setName("unclaim").setDescription("Release the current ticket."),
  new SlashCommandBuilder().setName("reopen").setDescription("Reopen a closed ticket."),
  new SlashCommandBuilder().setName("delete").setDescription("Delete the current ticket."),
  new SlashCommandBuilder()
    .setName("add").setDescription("Add a member to the current ticket.")
    .addUserOption(o => o.setName("user").setDescription("Member to add").setRequired(true)),
  new SlashCommandBuilder()
    .setName("remove").setDescription("Remove a member from the current ticket.")
    .addUserOption(o => o.setName("user").setDescription("Member to remove").setRequired(true)),
  new SlashCommandBuilder().setName("transcript").setDescription("Generate a transcript of the current ticket."),
  new SlashCommandBuilder().setName("ticketinfo").setDescription("Show current ticket information."),
  new SlashCommandBuilder().setName("ticketstats").setDescription("Show ticket statistics."),
  new SlashCommandBuilder().setName("tickets").setDescription("Show your ticket history."),
  new SlashCommandBuilder()
    .setName("rename").setDescription("Rename the current ticket.")
    .addStringOption(o => o.setName("name").setDescription("New channel name").setRequired(true).setMaxLength(80)),
  new SlashCommandBuilder()
    .setName("priority").setDescription("Set ticket priority.")
    .addStringOption(o => o.setName("level").setDescription("Priority").setRequired(true)
      .addChoices(
        {name:"Low", value:"low"}, {name:"Normal", value:"normal"},
        {name:"High", value:"high"}, {name:"Urgent", value:"urgent"}
      )),
  new SlashCommandBuilder()
    .setName("forceclose").setDescription("Staff: close a ticket immediately.")
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false).setMaxLength(500))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels.toString())
];

const commandData = commands.map(c => c.toJSON());

async function db(sql, params = []) {
  return pool.query(sql, params);
}

async function initDatabase() {
  await db(`
    CREATE TABLE IF NOT EXISTS guild_configs (
      guild_id TEXT PRIMARY KEY,
      category_id TEXT,
      staff_role_id TEXT,
      log_channel_id TEXT,
      transcript_channel_id TEXT,
      ticket_limit INTEGER NOT NULL DEFAULT 1,
      cleanup_minutes INTEGER NOT NULL DEFAULT 1440,
      ticket_counter BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS ticket_categories (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      emoji TEXT DEFAULT '🎫',
      UNIQUE(guild_id, name)
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      number BIGINT NOT NULL,
      channel_id TEXT UNIQUE,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      claimed_by TEXT,
      priority TEXT NOT NULL DEFAULT 'normal',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS tickets_guild_user_idx ON tickets(guild_id, user_id);
    CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets(guild_id, status);
    CREATE TABLE IF NOT EXISTS ticket_members (
      ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      added_by TEXT NOT NULL,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(ticket_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS ticket_claims (
      id BIGSERIAL PRIMARY KEY,
      ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      staff_id TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS ticket_logs (
      id BIGSERIAL PRIMARY KEY,
      ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
      guild_id TEXT NOT NULL,
      actor_id TEXT,
      action TEXT NOT NULL,
      details TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db(`
    INSERT INTO guild_configs (guild_id)
    SELECT $1
    WHERE $1 <> ''
    ON CONFLICT (guild_id) DO NOTHING
  `, [DEFAULT_GUILD_ID]);
}

async function getConfig(guildId) {
  const r = await db("SELECT * FROM guild_configs WHERE guild_id=$1", [guildId]);
  return r.rows[0] || null;
}

async function ensureConfig(guildId) {
  await db("INSERT INTO guild_configs(guild_id) VALUES($1) ON CONFLICT DO NOTHING", [guildId]);
  return getConfig(guildId);
}

function isStaff(member, config) {
  return !!member && (
    member.permissions.has(PermissionsBitField.Flags.ManageChannels) ||
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    (config?.staff_role_id && member.roles.cache.has(config.staff_role_id))
  );
}

function ticketName(number) {
  return `ticket-${String(number).padStart(6, "0")}`;
}

async function getTicket(channelId) {
  const r = await db("SELECT * FROM tickets WHERE channel_id=$1", [channelId]);
  return r.rows[0] || null;
}

async function logAction(ticket, actorId, action, details = "") {
  if (!ticket) return;
  await db(
    "INSERT INTO ticket_logs(ticket_id,guild_id,actor_id,action,details) VALUES($1,$2,$3,$4,$5)",
    [ticket.id, ticket.guild_id, actorId || null, action, details]
  );
  const config = await getConfig(ticket.guild_id);
  if (!config?.log_channel_id) return;
  try {
    const guild = await client.guilds.fetch(ticket.guild_id);
    const ch = await guild.channels.fetch(config.log_channel_id);
    if (!ch?.isTextBased()) return;
    const embed = new EmbedBuilder()
      .setTitle(`🎫 Ticket ${ticketName(ticket.number)}`)
      .addFields(
        {name:"Action", value: action, inline:true},
        {name:"Actor", value: actorId ? `<@${actorId}>` : "System", inline:true},
        {name:"Details", value: details || "—"}
      )
      .setTimestamp();
    await ch.send({embeds:[embed]});
  } catch (e) {
    console.warn("Log channel error:", e.message);
  }
}

async function fetchAllMessages(channel) {
  const all = [];
  let before;
  while (true) {
    const batch = await channel.messages.fetch({limit:100, before});
    if (!batch.size) break;
    all.push(...batch.values());
    if (batch.size < 100) break;
    before = batch.last().id;
  }
  return all.reverse();
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;");
}

async function makeTranscript(channel, ticket) {
  const messages = await fetchAllMessages(channel);
  const rows = messages.map(m => {
    const attachments = [...m.attachments.values()].map(a =>
      `<a href="${escapeHtml(a.url)}">${escapeHtml(a.name || "attachment")}</a>`).join(" ");
    return `<div class="message">
      <div class="meta"><b>${escapeHtml(m.author?.tag || m.author?.username || "Unknown")}</b>
      <span>${new Date(m.createdTimestamp).toISOString()}</span></div>
      <div class="content">${escapeHtml(m.content || "")}${attachments ? `<div>${attachments}</div>` : ""}</div>
    </div>`;
  }).join("\n");

  return `<!doctype html><html><head><meta charset="utf-8">
  <title>${escapeHtml(ticketName(ticket.number))}</title>
  <style>
  body{font-family:Arial,sans-serif;background:#f5f5f5;padding:20px}
  .message{background:#fff;border-radius:8px;padding:10px;margin:8px 0}
  .meta{color:#555;font-size:13px}.meta span{margin-left:10px;color:#888}
  .content{white-space:pre-wrap;margin-top:6px}
  </style></head><body>
  <h1>${escapeHtml(ticketName(ticket.number))}</h1>
  <p>Category: ${escapeHtml(ticket.category)} | User: ${escapeHtml(ticket.user_id)} |
  Status: ${escapeHtml(ticket.status)}</p>${rows}</body></html>`;
}

async function sendTranscript(ticket, channel, actorId) {
  const html = await makeTranscript(channel, ticket);
  const file = Buffer.from(html, "utf8");
  const attachment = new AttachmentBuilder(file, {name:`${ticketName(ticket.number)}-transcript.html`});
  const config = await getConfig(ticket.guild_id);
  if (config?.transcript_channel_id) {
    try {
      const ch = await channel.guild.channels.fetch(config.transcript_channel_id);
      if (ch?.isTextBased()) {
        await ch.send({
          content:`📄 Transcript for **${ticketName(ticket.number)}**`,
          files:[attachment]
        });
      }
    } catch(e) { console.warn("Transcript channel error:", e.message); }
  }
  await logAction(ticket, actorId, "TRANSCRIPT", "Transcript generated");
  return attachment;
}

async function createTicket(guild, user, category="General", reason="No reason provided") {
  const config = await ensureConfig(guild.id);
  if (!config.category_id || !config.staff_role_id) {
    throw new Error("Ticket system is not fully configured. An administrator must set the category and staff role with /ticketsetup.");
  }

  const open = await db(
    "SELECT COUNT(*)::int AS count FROM tickets WHERE guild_id=$1 AND user_id=$2 AND status='open'",
    [guild.id, user.id]
  );
  if (open.rows[0].count >= config.ticket_limit) {
    throw new Error(`You already have the maximum number of open tickets (${config.ticket_limit}).`);
  }

  const duplicate = await db(
    "SELECT * FROM tickets WHERE guild_id=$1 AND user_id=$2 AND status='open' ORDER BY id DESC LIMIT 1",
    [guild.id, user.id]
  );
  if (duplicate.rows[0]) {
    const ch = await guild.channels.fetch(duplicate.rows[0].channel_id).catch(()=>null);
    if (ch) return {ticket:duplicate.rows[0], channel:ch, existing:true};
  }

  const counter = await db(
    "UPDATE guild_configs SET ticket_counter=ticket_counter+1 WHERE guild_id=$1 RETURNING ticket_counter",
    [guild.id]
  );
  const number = counter.rows[0].ticket_counter;

  const channel = await guild.channels.create({
    name: ticketName(number),
    type: ChannelType.GuildText,
    parent: config.category_id,
    topic: `Ticket #${number} | User ${user.id} | Category ${category}`,
    permissionOverwrites: [
      {id:guild.roles.everyone.id, deny:[PermissionsBitField.Flags.ViewChannel]},
      {id:user.id, allow:[
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks
      ]},
      {id:config.staff_role_id, allow:[
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.ManageMessages
      ]},
      {id:guild.members.me.id, allow:[
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.ManageMessages,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks
      ]}
    ]
  });

  const ins = await db(
    `INSERT INTO tickets(guild_id,number,channel_id,user_id,category,reason)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [guild.id,number,channel.id,user.id,category,reason]
  );
  const ticket = ins.rows[0];

  await db("INSERT INTO ticket_members(ticket_id,user_id,added_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [ticket.id,user.id,user.id]);
  await logAction(ticket,user.id,"CREATE",`Category: ${category}; Reason: ${reason}`);

  const embed = new EmbedBuilder()
    .setTitle(`🎫 ${ticketName(number)}`)
    .setDescription(`Welcome <@${user.id}>! A staff member will assist you shortly.`)
    .addFields(
      {name:"Category",value:category,inline:true},
      {name:"Priority",value:"normal",inline:true},
      {name:"Reason",value:reason || "—"}
    )
    .setTimestamp();

  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket_claim").setLabel("Claim").setEmoji("🙋").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("ticket_close").setLabel("Close").setEmoji("🔒").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("ticket_transcript").setLabel("Transcript").setEmoji("📄").setStyle(ButtonStyle.Secondary)
  );
  await channel.send({content:`<@${user.id}> <@&${config.staff_role_id}>`,embeds:[embed],components:[controls]});

  try {
    await user.send(`🎫 Your ticket **${ticketName(number)}** has been created in **${guild.name}**: ${channel}`);
  } catch {}
  return {ticket,channel,existing:false};
}

async function chooseGuildForDM(interaction) {
  const possible = client.guilds.cache.filter(g => g.members.cache.has(interaction.user.id));
  const configured = [];
  for (const guild of possible.values()) {
    const cfg = await getConfig(guild.id);
    if (cfg?.category_id && cfg?.staff_role_id) configured.push(guild);
  }
  if (!configured.length) {
    await interaction.reply({content:"I couldn't find a configured server where you are a member. Ask a server administrator to configure the ticket system.",ephemeral:true});
    return null;
  }
  if (configured.length === 1) return configured[0];

  const menu = new StringSelectMenuBuilder()
    .setCustomId("dm_guild_select")
    .setPlaceholder("Choose a server")
    .addOptions(configured.slice(0,25).map(g => ({label:g.name.slice(0,100),value:g.id})));
  await interaction.reply({content:"Choose the server for your ticket:",components:[new ActionRowBuilder().addComponents(menu)],ephemeral:true});
  return null;
}

async function requireTicket(interaction) {
  const ticket = await getTicket(interaction.channelId);
  if (!ticket) {
    await interaction.reply({content:"This command can only be used inside a ticket channel.",ephemeral:true});
    return null;
  }
  return ticket;
}

async function requireStaff(interaction,ticket) {
  const config = await getConfig(ticket.guild_id);
  if (!isStaff(interaction.member,config)) {
    await interaction.reply({content:"You do not have ticket staff permissions.",ephemeral:true});
    return null;
  }
  return config;
}

async function closeTicket(interaction, ticket, reason="No reason provided") {
  const config = await getConfig(ticket.guild_id);
  await db("UPDATE tickets SET status='closed',closed_at=NOW() WHERE id=$1",[ticket.id]);
  await logAction(ticket,interaction.user.id,"CLOSE",reason);
  await interaction.channel.permissionOverwrites.edit(ticket.user_id,{
    SendMessages:false, ViewChannel:true
  }).catch(()=>{});
  if (config?.staff_role_id) {
    await interaction.channel.permissionOverwrites.edit(config.staff_role_id,{SendMessages:false,ViewChannel:true}).catch(()=>{});
  }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket_reopen").setLabel("Reopen").setEmoji("🔓").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("ticket_delete").setLabel("Delete").setEmoji("🗑️").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("ticket_transcript").setLabel("Transcript").setEmoji("📄").setStyle(ButtonStyle.Secondary)
  );
  await interaction.channel.send({embeds:[new EmbedBuilder().setTitle("🔒 Ticket Closed").setDescription(`Closed by <@${interaction.user.id}>.\nReason: ${reason}`)],components:[row]});
  try { await client.users.fetch(ticket.user_id).then(u=>u.send(`🔒 Your ticket **${ticketName(ticket.number)}** in **${interaction.guild.name}** was closed.`)); } catch {}
}

async function reopenTicket(interaction,ticket) {
  const config = await getConfig(ticket.guild_id);
  await db("UPDATE tickets SET status='open',closed_at=NULL WHERE id=$1",[ticket.id]);
  await interaction.channel.permissionOverwrites.edit(ticket.user_id,{
    SendMessages:true, ViewChannel:true, ReadMessageHistory:true
  }).catch(()=>{});
  if (config?.staff_role_id) await interaction.channel.permissionOverwrites.edit(config.staff_role_id,{SendMessages:true,ViewChannel:true,ReadMessageHistory:true}).catch(()=>{});
  await logAction(ticket,interaction.user.id,"REOPEN");
  await interaction.channel.send({content:`🔓 Ticket reopened by <@${interaction.user.id}>.`});
}

async function deleteTicket(interaction,ticket) {
  await sendTranscript(ticket,interaction.channel,interaction.user.id).catch(()=>{});
  await db("UPDATE tickets SET status='deleted',deleted_at=NOW() WHERE id=$1",[ticket.id]);
  await logAction(ticket,interaction.user.id,"DELETE");
  try { await client.users.fetch(ticket.user_id).then(u=>u.send(`🗑️ Your ticket **${ticketName(ticket.number)}** was deleted.`)); } catch {}
  setTimeout(()=>interaction.channel.delete("Ticket deleted").catch(()=>{}),1000);
}

async function showCategoryMenu(interaction, guildId, mode = "guild") {
  const cats = await db("SELECT name,emoji FROM ticket_categories WHERE guild_id=$1 ORDER BY id",[guildId]);
  const options = cats.rows.length ? cats.rows : [{name:"General",emoji:"🎫"}];
  const customId = mode === "dm" ? `dm_category:${guildId}` : "guild_ticket_category";
  const menu = new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder("Choose ticket category")
    .addOptions(options.slice(0,25).map(x=>({label:x.name.slice(0,100),value:x.name.slice(0,100),emoji:x.emoji || undefined})));
  const row = new ActionRowBuilder().addComponents(menu);
  if (interaction.deferred || interaction.replied) return interaction.editReply({content:"Choose a ticket category:",components:[row]});
  return interaction.reply({content:"Choose a ticket category:",components:[row],ephemeral:mode !== "dm"});
}

async function handleButton(interaction) {
  if (interaction.customId === "ticket_create") {
    return showCategoryMenu(interaction, interaction.guildId, "guild");
  }
  if (interaction.customId === "dm_ticket_start") {
    const guild = await chooseGuildForDM(interaction);
    if (guild) {
      const cats = await db("SELECT name,emoji FROM ticket_categories WHERE guild_id=$1 ORDER BY id",[guild.id]);
      const options = cats.rows.length ? cats.rows : [{name:"General",emoji:"🎫"}];
      const menu = new StringSelectMenuBuilder().setCustomId(`dm_category:${guild.id}`).setPlaceholder("Choose ticket category")
        .addOptions(options.slice(0,25).map(x=>({label:x.name.slice(0,100),value:x.name.slice(0,100),emoji:x.emoji || undefined})));
      await interaction.reply({content:`Select a category for **${guild.name}**:`,components:[new ActionRowBuilder().addComponents(menu)],ephemeral:true});
    }
    return;
  }

  const ticket = await getTicket(interaction.channelId);
  if (!ticket) {
    await interaction.reply({content:"This button is not attached to a ticket.",ephemeral:true}); return;
  }

  if (interaction.customId === "ticket_claim") {
    const config = await requireStaff(interaction,ticket); if (!config) return;
    if (ticket.claimed_by && ticket.claimed_by !== interaction.user.id) {
      await interaction.reply({content:`This ticket is already claimed by <@${ticket.claimed_by}>.`,ephemeral:true}); return;
    }
    await db("UPDATE tickets SET claimed_by=$1 WHERE id=$2",[interaction.user.id,ticket.id]);
    await db("INSERT INTO ticket_claims(ticket_id,staff_id,action) VALUES($1,$2,'claim')",[ticket.id,interaction.user.id]);
    await logAction(ticket,interaction.user.id,"CLAIM");
    await interaction.reply({content:`🙋 Claimed by <@${interaction.user.id}>.`});
    return;
  }

  if (interaction.customId === "ticket_close") {
    const config = await getConfig(ticket.guild_id);
    if (ticket.user_id !== interaction.user.id && !isStaff(interaction.member,config)) {
      await interaction.reply({content:"Only the ticket owner or ticket staff can close this ticket.",ephemeral:true}); return;
    }
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("confirm_close").setLabel("Confirm Close").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("cancel_close").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    );
    await interaction.reply({content:"Are you sure you want to close this ticket?",components:[row],ephemeral:true});
    return;
  }

  if (interaction.customId === "confirm_close") {
    await closeTicket(interaction,ticket); await interaction.editReply({content:"Ticket closed.",components:[]}); return;
  }
  if (interaction.customId === "cancel_close") {
    await interaction.update({content:"Close cancelled.",components:[]}); return;
  }
  if (interaction.customId === "ticket_reopen") {
    const config = await requireStaff(interaction,ticket); if (!config) return;
    await interaction.deferUpdate(); await reopenTicket(interaction,ticket); return;
  }
  if (interaction.customId === "ticket_delete") {
    const config = await requireStaff(interaction,ticket); if (!config) return;
    await interaction.reply({content:"Delete this ticket permanently?",components:[
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("confirm_delete").setLabel("Confirm Delete").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("cancel_delete").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
      )
    ],ephemeral:true}); return;
  }
  if (interaction.customId === "confirm_delete") {
    await interaction.deferUpdate(); await deleteTicket(interaction,ticket); return;
  }
  if (interaction.customId === "cancel_delete") {
    await interaction.update({content:"Deletion cancelled.",components:[]}); return;
  }
  if (interaction.customId === "ticket_transcript") {
    const config = await requireStaff(interaction,ticket); if (!config) return;
    await interaction.deferReply({ephemeral:true});
    const attachment = await sendTranscript(ticket,interaction.channel,interaction.user.id);
    await interaction.editReply({content:"Transcript generated.",files:[attachment]}); return;
  }
}

async function handleSelect(interaction) {
  if (interaction.customId === "dm_guild_select") {
    const guild = client.guilds.cache.get(interaction.values[0]);
    if (!guild) return interaction.update({content:"That server is no longer available.",components:[]});
    const cats = await db("SELECT name,emoji FROM ticket_categories WHERE guild_id=$1 ORDER BY id",[guild.id]);
    const options = cats.rows.length ? cats.rows : [{name:"General",emoji:"🎫"}];
    const menu = new StringSelectMenuBuilder().setCustomId(`dm_category:${guild.id}`).setPlaceholder("Choose ticket category")
      .addOptions(options.slice(0,25).map(x=>({label:x.name,value:x.name,emoji:x.emoji || undefined})));
    await interaction.update({content:`Select a category for **${guild.name}**:`,components:[new ActionRowBuilder().addComponents(menu)]});
    return;
  }
  if (interaction.customId === "guild_ticket_category") {
    const category = interaction.values[0];
    const modal = new ModalBuilder().setCustomId(`guild_reason:${interaction.guildId}:${encodeURIComponent(category)}`).setTitle("Ticket Reason");
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("reason").setLabel("What do you need help with?")
        .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)
    ));
    await interaction.showModal(modal);
    return;
  }
  if (interaction.customId.startsWith("dm_category:")) {
    const guildId = interaction.customId.split(":")[1];
    const modal = new ModalBuilder().setCustomId(`dm_reason:${guildId}:${encodeURIComponent(interaction.values[0])}`).setTitle("Ticket Reason");
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("reason").setLabel("What do you need help with?")
        .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)
    ));
    await interaction.showModal(modal); return;
  }
}

async function registerCommands() {
  const rest = new REST({version:"10"}).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), {body:commandData});
  console.log("Global slash commands registered.");
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await initDatabase();
  await registerCommands();
  setInterval(autoCleanup, 60_000);
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isButton()) return handleButton(interaction);
    if (interaction.isStringSelectMenu()) return handleSelect(interaction);
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("guild_reason:")) {
        const [,guildId,encoded] = interaction.customId.split(":");
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return interaction.reply({content:"Server not found.",ephemeral:true});
        const category = decodeURIComponent(encoded);
        const reason = interaction.fields.getTextInputValue("reason");
        await interaction.deferReply({ephemeral:true});
        const result = await createTicket(guild,interaction.user,category,reason);
        return interaction.editReply({content:result.existing ? `You already have ${result.channel}.` : `Ticket created: ${result.channel}`});
      }
      if (interaction.customId.startsWith("dm_reason:")) {
        const [,guildId,encoded] = interaction.customId.split(":");
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return interaction.reply({content:"Server not found.",ephemeral:true});
        const category = decodeURIComponent(encoded);
        const reason = interaction.fields.getTextInputValue("reason");
        await interaction.deferReply({ephemeral:true});
        const result = await createTicket(guild,interaction.user,category,reason);
        return interaction.editReply({content:result.existing ? `You already have ${result.channel}.` : `Ticket created: ${result.channel}`});
      }
    }
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "ticket") {
      if (!interaction.inGuild()) {
        const guild = await chooseGuildForDM(interaction);
        if (!guild) return;
        const cats = await db("SELECT name,emoji FROM ticket_categories WHERE guild_id=$1 ORDER BY id",[guild.id]);
        const options = cats.rows.length ? cats.rows : [{name:"General",emoji:"🎫"}];
        const menu = new StringSelectMenuBuilder().setCustomId(`dm_category:${guild.id}`).setPlaceholder("Choose ticket category")
          .addOptions(options.slice(0,25).map(x=>({label:x.name,value:x.name,emoji:x.emoji || undefined})));
        return interaction.editReply({content:`Select a category for **${guild.name}**:`,components:[new ActionRowBuilder().addComponents(menu)]});
      }
      const cats = await db("SELECT name,emoji FROM ticket_categories WHERE guild_id=$1 ORDER BY id",[interaction.guildId]);
      const options = cats.rows.length ? cats.rows : [{name:"General",emoji:"🎫"}];
      const menu = new StringSelectMenuBuilder().setCustomId("guild_ticket_category").setPlaceholder("Choose ticket category")
        .addOptions(options.slice(0,25).map(x=>({label:x.name,value:x.name,emoji:x.emoji || undefined})));
      return interaction.reply({content:"Choose a ticket category:",components:[new ActionRowBuilder().addComponents(menu)],ephemeral:true});
    }

    if (interaction.commandName === "ticketpanel") {
      const config = await ensureConfig(interaction.guildId);
      const embed = new EmbedBuilder().setTitle("🎫 Support Center")
        .setDescription("Need help? Click **Create Ticket** below. Your ticket will be private and visible to you and support staff.")
        .setTimestamp();
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket_create").setLabel("Create Ticket").setEmoji("🎫").setStyle(ButtonStyle.Primary)
      );
      await interaction.channel.send({embeds:[embed],components:[row]});
      return interaction.reply({content:"Ticket panel sent.",ephemeral:true});
    }

    if (interaction.commandName === "ticketsetup") {
      const config = await ensureConfig(interaction.guildId);
      const sub = interaction.options.getSubcommand();
      if (sub === "category") await db("UPDATE guild_configs SET category_id=$1 WHERE guild_id=$2",[interaction.options.getChannel("channel").id,interaction.guildId]);
      if (sub === "staffrole") await db("UPDATE guild_configs SET staff_role_id=$1 WHERE guild_id=$2",[interaction.options.getRole("role").id,interaction.guildId]);
      if (sub === "logs") await db("UPDATE guild_configs SET log_channel_id=$1 WHERE guild_id=$2",[interaction.options.getChannel("channel").id,interaction.guildId]);
      if (sub === "transcripts") await db("UPDATE guild_configs SET transcript_channel_id=$1 WHERE guild_id=$2",[interaction.options.getChannel("channel").id,interaction.guildId]);
      if (sub === "limit") await db("UPDATE guild_configs SET ticket_limit=$1 WHERE guild_id=$2",[interaction.options.getInteger("amount"),interaction.guildId]);
      if (sub === "cleanup") await db("UPDATE guild_configs SET cleanup_minutes=$1 WHERE guild_id=$2",[interaction.options.getInteger("minutes"),interaction.guildId]);
      const fresh = await getConfig(interaction.guildId);
      return interaction.reply({content:`Configuration updated.\nCategory: ${fresh.category_id ? `<#${fresh.category_id}>`:"Not set"}\nStaff: ${fresh.staff_role_id ? `<@&${fresh.staff_role_id}>`:"Not set"}\nLogs: ${fresh.log_channel_id ? `<#${fresh.log_channel_id}>`:"Not set"}\nTranscripts: ${fresh.transcript_channel_id ? `<#${fresh.transcript_channel_id}>`:"Not set"}\nLimit: ${fresh.ticket_limit}\nCleanup: ${fresh.cleanup_minutes ? fresh.cleanup_minutes+" minutes" : "Disabled"}`,ephemeral:true});
    }

    if (interaction.commandName === "ticketcategory") {
      const sub = interaction.options.getSubcommand();
      if (sub === "add") {
        const name = interaction.options.getString("name");
        const emoji = interaction.options.getString("emoji") || "🎫";
        await db("INSERT INTO ticket_categories(guild_id,name,emoji) VALUES($1,$2,$3) ON CONFLICT(guild_id,name) DO UPDATE SET emoji=EXCLUDED.emoji",[interaction.guildId,name,emoji]);
        return interaction.reply({content:`Added ticket category **${name}**.`,ephemeral:true});
      }
      if (sub === "remove") {
        await db("DELETE FROM ticket_categories WHERE guild_id=$1 AND name=$2",[interaction.guildId,interaction.options.getString("name")]);
        return interaction.reply({content:"Category removed.",ephemeral:true});
      }
      const r = await db("SELECT name,emoji FROM ticket_categories WHERE guild_id=$1 ORDER BY id",[interaction.guildId]);
      return interaction.reply({content:r.rows.length ? r.rows.map(x=>`${x.emoji} **${x.name}**`).join("\n") : "No custom categories. The default General category is available.",ephemeral:true});
    }

    const ticket = await requireTicket(interaction);
    if (!ticket) return;
    const config = await getConfig(ticket.guild_id);
    if (interaction.commandName === "close" || interaction.commandName === "forceclose") {
      if (interaction.commandName === "forceclose" && !isStaff(interaction.member,config)) return interaction.reply({content:"Staff only.",ephemeral:true});
      if (interaction.commandName === "close" && ticket.user_id !== interaction.user.id && !isStaff(interaction.member,config)) return interaction.reply({content:"Only the owner or staff can close this ticket.",ephemeral:true});
      const reason = interaction.options.getString("reason") || "No reason provided";
      if (interaction.commandName === "close") {
        return interaction.reply({content:"Confirm ticket closure:",components:[new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("confirm_close").setLabel("Confirm Close").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId("cancel_close").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
        )],ephemeral:true});
      }
      await closeTicket(interaction,ticket,reason); return;
    }

    if (interaction.commandName === "claim" || interaction.commandName === "unclaim") {
      if (!isStaff(interaction.member,config)) return interaction.reply({content:"Staff only.",ephemeral:true});
      if (interaction.commandName === "claim") {
        if (ticket.claimed_by && ticket.claimed_by !== interaction.user.id) return interaction.reply({content:`Already claimed by <@${ticket.claimed_by}>.`,ephemeral:true});
        await db("UPDATE tickets SET claimed_by=$1 WHERE id=$2",[interaction.user.id,ticket.id]);
        await db("INSERT INTO ticket_claims(ticket_id,staff_id,action) VALUES($1,$2,'claim')",[ticket.id,interaction.user.id]);
        await logAction(ticket,interaction.user.id,"CLAIM");
        return interaction.reply({content:`🙋 Ticket claimed by <@${interaction.user.id}>.`});
      }
      if (ticket.claimed_by !== interaction.user.id) return interaction.reply({content:"You are not the current claimant.",ephemeral:true});
      await db("UPDATE tickets SET claimed_by=NULL WHERE id=$1",[ticket.id]);
      await db("INSERT INTO ticket_claims(ticket_id,staff_id,action) VALUES($1,$2,'unclaim')",[ticket.id,interaction.user.id]);
      await logAction(ticket,interaction.user.id,"UNCLAIM");
      return interaction.reply({content:"Ticket unclaimed."});
    }

    if (interaction.commandName === "reopen") {
      if (!isStaff(interaction.member,config)) return interaction.reply({content:"Staff only.",ephemeral:true});
      await reopenTicket(interaction,ticket); return interaction.reply({content:"Ticket reopened."});
    }

    if (interaction.commandName === "delete") {
      if (!isStaff(interaction.member,config)) return interaction.reply({content:"Staff only.",ephemeral:true});
      await interaction.reply({content:"Confirm deletion:",components:[new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("confirm_delete").setLabel("Confirm Delete").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("cancel_delete").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
      )],ephemeral:true}); return;
    }

    if (interaction.commandName === "add" || interaction.commandName === "remove") {
      if (!isStaff(interaction.member,config)) return interaction.reply({content:"Staff only.",ephemeral:true});
      const user = interaction.options.getUser("user");
      if (interaction.commandName === "add") {
        await interaction.channel.permissionOverwrites.edit(user.id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true,AttachFiles:true,EmbedLinks:true});
        await db("INSERT INTO ticket_members(ticket_id,user_id,added_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[ticket.id,user.id,interaction.user.id]);
        await logAction(ticket,interaction.user.id,"ADD",user.tag);
        return interaction.reply({content:`Added ${user} to the ticket.`});
      }
      if (user.id === ticket.user_id) return interaction.reply({content:"You cannot remove the ticket owner.",ephemeral:true});
      await interaction.channel.permissionOverwrites.delete(user.id).catch(()=>{});
      await db("DELETE FROM ticket_members WHERE ticket_id=$1 AND user_id=$2",[ticket.id,user.id]);
      await logAction(ticket,interaction.user.id,"REMOVE",user.tag);
      return interaction.reply({content:`Removed ${user} from the ticket.`});
    }

    if (interaction.commandName === "transcript") {
      if (!isStaff(interaction.member,config)) return interaction.reply({content:"Staff only.",ephemeral:true});
      await interaction.deferReply({ephemeral:true});
      const attachment = await sendTranscript(ticket,interaction.channel,interaction.user.id);
      return interaction.editReply({content:"Transcript generated.",files:[attachment]});
    }

    if (interaction.commandName === "ticketinfo") {
      return interaction.reply({embeds:[new EmbedBuilder().setTitle(`🎫 ${ticketName(ticket.number)}`)
        .addFields(
          {name:"Owner",value:`<@${ticket.user_id}>`,inline:true},
          {name:"Category",value:ticket.category,inline:true},
          {name:"Status",value:ticket.status,inline:true},
          {name:"Claimed By",value:ticket.claimed_by ? `<@${ticket.claimed_by}>`:"Unclaimed",inline:true},
          {name:"Priority",value:ticket.priority,inline:true},
          {name:"Reason",value:ticket.reason || "—"}
        ).setTimestamp()],ephemeral:true});
    }

    if (interaction.commandName === "ticketstats") {
      if (!isStaff(interaction.member,config)) return interaction.reply({content:"Staff only.",ephemeral:true});
      const r = await db(`SELECT
        COUNT(*) FILTER(WHERE status='open')::int AS open,
        COUNT(*) FILTER(WHERE status='closed')::int AS closed,
        COUNT(*) FILTER(WHERE status='deleted')::int AS deleted,
        COUNT(*)::int AS total
        FROM tickets WHERE guild_id=$1`,[interaction.guildId]);
      const claim = await db(`SELECT staff_id,COUNT(*)::int AS count FROM ticket_claims tc
        JOIN tickets t ON t.id=tc.ticket_id WHERE t.guild_id=$1 AND tc.action='claim'
        GROUP BY staff_id ORDER BY count DESC LIMIT 10`,[interaction.guildId]);
      return interaction.reply({embeds:[new EmbedBuilder().setTitle("🎫 Ticket Statistics")
        .addFields(
          {name:"Open",value:String(r.rows[0].open),inline:true},
          {name:"Closed",value:String(r.rows[0].closed),inline:true},
          {name:"Deleted",value:String(r.rows[0].deleted),inline:true},
          {name:"Total",value:String(r.rows[0].total),inline:true},
          {name:"Top Claims",value:claim.rows.length ? claim.rows.map(x=>`<@${x.staff_id}> — ${x.count}`).join("\n"):"No claims yet"}
        ).setTimestamp()],ephemeral:true});
    }

    if (interaction.commandName === "tickets") {
      const r = await db(`SELECT number,category,status,created_at,channel_id FROM tickets
        WHERE guild_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 20`,[interaction.guildId,interaction.user.id]);
      return interaction.reply({content:r.rows.length ? r.rows.map(x=>`${ticketName(x.number)} — **${x.category}** — ${x.status} — <#${x.channel_id}>`).join("\n") : "You have no ticket history.",ephemeral:true});
    }

    if (interaction.commandName === "rename") {
      if (!isStaff(interaction.member,config)) return interaction.reply({content:"Staff only.",ephemeral:true});
      const name = interaction.options.getString("name").toLowerCase().replace(/[^a-z0-9-]/g,"-").slice(0,90);
      await interaction.channel.setName(name);
      await logAction(ticket,interaction.user.id,"RENAME",name);
      return interaction.reply({content:`Renamed ticket to **${name}**.`});
    }

    if (interaction.commandName === "priority") {
      if (!isStaff(interaction.member,config)) return interaction.reply({content:"Staff only.",ephemeral:true});
      const level = interaction.options.getString("level");
      await db("UPDATE tickets SET priority=$1 WHERE id=$2",[level,ticket.id]);
      await logAction(ticket,interaction.user.id,"PRIORITY",level);
      return interaction.reply({content:`Priority set to **${level}**.`});
    }
  } catch (err) {
    console.error(err);
    const message = err?.message?.slice(0,1500) || "An unexpected error occurred.";
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({content:`❌ ${message}`,ephemeral:true}).catch(()=>{});
    } else {
      await interaction.reply({content:`❌ ${message}`,ephemeral:true}).catch(()=>{});
    }
  }
});

client.on("channelDelete", async channel => {
  try {
    const ticket = await getTicket(channel.id);
    if (ticket && ticket.status !== "deleted") {
      await db("UPDATE tickets SET status='deleted',deleted_at=NOW() WHERE id=$1",[ticket.id]);
      await logAction(ticket,null,"CHANNEL_DELETED","Ticket channel deleted externally");
    }
  } catch(e) { console.error("channelDelete:",e.message); }
});

client.on("messageCreate", async message => {
  if (message.author.bot || message.guild) return;
  const text = message.content.trim().toLowerCase();
  if (text === "ticket" || text === "/ticket") {
    try {
      const possible = client.guilds.cache.filter(g => g.members.cache.has(message.author.id));
      const configured = [];
      for (const guild of possible.values()) {
        const cfg = await getConfig(guild.id);
        if (cfg?.category_id && cfg?.staff_role_id) configured.push(guild);
      }
      if (!configured.length) return message.reply("I couldn't find a configured server where you are a member.");
      const menu = new StringSelectMenuBuilder().setCustomId(configured.length === 1 ? `dm_category:${configured[0].id}` : "dm_guild_select")
        .setPlaceholder(configured.length === 1 ? "Choose ticket category" : "Choose server");
      if (configured.length === 1) {
        const cats = await db("SELECT name,emoji FROM ticket_categories WHERE guild_id=$1 ORDER BY id",[configured[0].id]);
        const options = cats.rows.length ? cats.rows : [{name:"General",emoji:"🎫"}];
        menu.addOptions(options.slice(0,25).map(x=>({label:x.name,value:x.name,emoji:x.emoji || undefined})));
      } else {
        menu.addOptions(configured.slice(0,25).map(g=>({label:g.name.slice(0,100),value:g.id})));
      }
      await message.reply({content:"🎫 Start a ticket:",components:[new ActionRowBuilder().addComponents(menu)]});
    } catch(e) { console.error(e); }
  }
});

async function autoCleanup() {
  try {
    const r = await db("SELECT * FROM guild_configs WHERE cleanup_minutes > 0");
    for (const cfg of r.rows) {
      const tickets = await db(`SELECT * FROM tickets WHERE guild_id=$1 AND status='closed'
        AND closed_at < NOW() - ($2 * INTERVAL '1 minute') LIMIT 25`,[cfg.guild_id,cfg.cleanup_minutes]);
      for (const ticket of tickets.rows) {
        const guild = client.guilds.cache.get(ticket.guild_id);
        if (!guild) continue;
        const channel = await guild.channels.fetch(ticket.channel_id).catch(()=>null);
        if (channel) {
          await sendTranscript(ticket,channel,client.user.id).catch(()=>{});
          await channel.delete("Automatic closed ticket cleanup").catch(()=>{});
        } else {
          await db("UPDATE tickets SET status='deleted',deleted_at=NOW() WHERE id=$1",[ticket.id]);
        }
      }
    }
  } catch(e) { console.error("Auto cleanup:",e.message); }
}

process.on("unhandledRejection", e => console.error("Unhandled rejection:",e));
process.on("uncaughtException", e => console.error("Uncaught exception:",e));

(async () => {
  try {
    await pool.query("SELECT 1");
    await client.login(TOKEN);
  } catch(e) {
    console.error("Startup failed:",e);
    process.exit(1);
  }
})();
