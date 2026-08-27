const {
  Client,
  GatewayIntentBits,
  Partials,
  Events
} = require("discord.js");

const express = require("express");
const { Pool } = require("pg");

const TOKEN = process.env.DISCORD_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

const GUILD_ID = "1493700265499689154";
const SUPPORT_ROLE_ID = "1542498406981959801";
const LOG_CHANNEL_ID = "1542500573000106024";

if (!TOKEN) {
  console.error("DISCORD_TOKEN is missing!");
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing!");
  process.exit(1);
}

/* Web server for Render */
const app = express();

app.get("/", (req, res) => {
  res.send("Grand Mafia RP Support Bot Online");
});

app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("Web server started");
});

/* PostgreSQL */
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

/* Discord */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

/* Database setup */
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

    CREATE TABLE IF NOT EXISTS blocked_players (
      player_id TEXT PRIMARY KEY,
      player_tag TEXT,
      blocked_by TEXT,
      reason TEXT,
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

  console.log("PostgreSQL connected and tables ready");
}

/* Bot ready */
client.once(Events.ClientReady, async () => {
  console.log(`Bot online: ${client.user.tag}`);

  try {
    await setupDatabase();
  } catch (error) {
    console.error("Database error:", error);
  }
});

/* Simple DM test */
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  if (message.guild) return;

  try {
    await message.author.send(
      "🎫 Your message was received by Grand Mafia RP Support."
    );

    console.log(
      `DM received from ${message.author.tag}`
    );
  } catch (error) {
    console.error("DM error:", error.message);
  }
});

/* Login */
client.login(TOKEN)
  .then(() => {
    console.log("Discord login successful");
  })
  .catch(error => {
    console.error("Discord login failed:", error);
    process.exit(1);
  });
