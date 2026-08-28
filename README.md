# Full Discord Ticket Bot

## Requirements
- Node.js 20+
- A Discord bot application
- PostgreSQL database
- Bot permissions: Manage Channels, Manage Roles (if you later add role management), Send Messages, Read Message History, Embed Links, Attach Files, Manage Messages.
- Enable the **Server Members Intent**, **Message Content Intent**, and **Direct Messages** support where applicable.

## Install
1. Rename `.env.example` to `.env`.
2. Fill in `DISCORD_TOKEN`, `CLIENT_ID`, and `DATABASE_URL`.
3. Run:
   npm install
   npm start

The bot creates the PostgreSQL tables automatically.

## Initial setup
Inside your server, an administrator runs:

/ticketsetup category #YOUR_CATEGORY
/ticketsetup staffrole @TicketStaff
/ticketsetup logs #ticket-logs
/ticketsetup transcripts #ticket-transcripts
/ticketsetup limit 1
/ticketsetup cleanup 1440

Then create categories if wanted:

/ticketcategory add name:Support emoji:🛠️
/ticketcategory add name:Report emoji:🚨
/ticketcategory add name:Billing emoji:💳

Send the panel:

/ticketpanel

## Main commands
/ticket
/ticketpanel
/ticketsetup
/ticketcategory
/close
/forceclose
/claim
/unclaim
/reopen
/delete
/add
/remove
/transcript
/ticketinfo
/ticketstats
/tickets
/rename
/priority

## DM ticket creation
Users can use `/ticket` in DM after global slash commands have propagated, or simply DM the bot:
ticket

The bot finds configured servers where the user is a member and lets them choose a server/category.

## Important
The bot needs to be able to create channels under the configured category. The staff role must be below the bot's highest role if you later add role-management features.

Existing tickets and counters are stored in PostgreSQL, so bot restarts do not reset the ticket system.

Transcripts are generated as HTML and can be posted to the configured transcript channel.
