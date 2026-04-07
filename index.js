const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  SlashCommandBuilder,
  Routes,
  REST,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const { Pool } = require('pg');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

// 🔗 PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 🧱 READY (DB setup)
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_config (
      guild_id TEXT PRIMARY KEY,
      channel TEXT,
      role TEXT,
      underage_role TEXT,
      min_age INT
    );
  `);

  await pool.query(`
    ALTER TABLE guild_config
    ADD COLUMN IF NOT EXISTS underage_role TEXT;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS verified_users (
      user_id TEXT,
      guild_id TEXT,
      PRIMARY KEY (user_id, guild_id)
    );
  `);
});

// 📥 Get config
async function getConfig(guildId) {
  const res = await pool.query(
    "SELECT * FROM guild_config WHERE guild_id = $1",
    [guildId]
  );

  if (res.rows.length === 0) {
    await pool.query(
      "INSERT INTO guild_config (guild_id, min_age) VALUES ($1, $2)",
      [guildId, 13]
    );

    return { channel: null, role: null, underage_role: null, min_age: 13 };
  }

  return res.rows[0];
}

// ⚡ SLASH COMMANDS
const commands = [
  new SlashCommandBuilder()
    .setName('setverifychannel')
    .setDescription('Set verification channel')
    .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)),

  new SlashCommandBuilder()
    .setName('setverifyrole')
    .setDescription('Set verified role')
    .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)),

  new SlashCommandBuilder()
    .setName('setunderagerole')
    .setDescription('Set underage role')
    .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)),

  new SlashCommandBuilder()
    .setName('setminage')
    .setDescription('Set minimum age')
    .addIntegerOption(o => o.setName('age').setDescription('Minimum age').setRequired(true)),

  new SlashCommandBuilder()
    .setName('sendverify')
    .setDescription('Send verification message'),

  new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Start verification'),

  new SlashCommandBuilder()
    .setName('resetuser')
    .setDescription('Reset a user verification')
    .addUserOption(o =>
      o.setName('user')
        .setDescription('User to reset')
        .setRequired(true)
    )
];

// 🚀 Register commands
const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
    console.log("Slash commands registered");
  } catch (err) {
    console.error(err);
  }
})();

// 🎯 Interaction handler
client.on('interactionCreate', async (interaction) => {

  // ================= SLASH COMMANDS =================
  if (interaction.isChatInputCommand()) {

    const guildConfig = await getConfig(interaction.guild.id);
    const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

    if (interaction.commandName === 'setverifychannel') {
      if (!isAdmin) return interaction.reply({ content: "❌ Admin only", ephemeral: true });

      const channel = interaction.options.getChannel('channel');
      await pool.query("UPDATE guild_config SET channel=$1 WHERE guild_id=$2",[channel.id, interaction.guild.id]);

      return interaction.reply(`✅ Channel set to ${channel}`);
    }

    if (interaction.commandName === 'setverifyrole') {
      if (!isAdmin) return interaction.reply({ content: "❌ Admin only", ephemeral: true });

      const role = interaction.options.getRole('role');
      await pool.query("UPDATE guild_config SET role=$1 WHERE guild_id=$2",[role.id, interaction.guild.id]);

      return interaction.reply(`✅ Verified role set to ${role.name}`);
    }

    if (interaction.commandName === 'setunderagerole') {
      if (!isAdmin) return interaction.reply({ content: "❌ Admin only", ephemeral: true });

      const role = interaction.options.getRole('role');
      await pool.query("UPDATE guild_config SET underage_role=$1 WHERE guild_id=$2",[role.id, interaction.guild.id]);

      return interaction.reply(`✅ Underage role set to ${role.name}`);
    }

    if (interaction.commandName === 'setminage') {
      if (!isAdmin) return interaction.reply({ content: "❌ Admin only", ephemeral: true });

      const age = interaction.options.getInteger('age');
      await pool.query("UPDATE guild_config SET min_age=$1 WHERE guild_id=$2",[age, interaction.guild.id]);

      return interaction.reply(`✅ Min age set to ${age}`);
    }

    if (interaction.commandName === 'sendverify') {
      if (!isAdmin) return interaction.reply({ content: "❌ Admin only", ephemeral: true });

      const channel = interaction.guild.channels.cache.get(guildConfig.channel);
      await channel.send("🔐 **Verification Required**\nUse `/verify` to begin.");

      return interaction.reply({ content: "✅ Sent", ephemeral: true });
    }

    if (interaction.commandName === 'resetuser') {
      if (!isAdmin) return interaction.reply({ content: "❌ Admin only", ephemeral: true });

      const user = interaction.options.getUser('user');

      await pool.query(
        "DELETE FROM verified_users WHERE user_id=$1 AND guild_id=$2",
        [user.id, interaction.guild.id]
      );

      return interaction.reply(`✅ Reset verification for ${user.tag}`);
    }

    // 🔥 VERIFY (BUTTON START)
    if (interaction.commandName === 'verify') {

      const check = await pool.query(
        "SELECT * FROM verified_users WHERE user_id=$1 AND guild_id=$2",
        [interaction.user.id, interaction.guild.id]
      );

      if (check.rows.length > 0) {
        return interaction.reply({
          content: "❌ You already verified.",
          ephemeral: true
        });
      }

      const button = new ButtonBuilder()
        .setCustomId('start_verify')
        .setLabel('Verify Age')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(button);

      return interaction.reply({
        content: "Click below to verify your age:",
        components: [row],
        ephemeral: true
      });
    }
  }

  // ================= BUTTON =================
  if (interaction.isButton()) {
    if (interaction.customId === 'start_verify') {

      const modal = new ModalBuilder()
        .setCustomId('age_modal')
        .setTitle('Age Verification');

      const input = new TextInputBuilder()
        .setCustomId('age_input')
        .setLabel('Enter your age')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const row = new ActionRowBuilder().addComponents(input);
      modal.addComponents(row);

      return interaction.showModal(modal);
    }
  }

  // ================= MODAL =================
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'age_modal') {

      const guildConfig = await getConfig(interaction.guild.id);

      const age = parseInt(interaction.fields.getTextInputValue('age_input'));

      if (isNaN(age)) {
        return interaction.reply({ content: "❌ Invalid number", ephemeral: true });
      }

      const verifiedRole = interaction.guild.roles.cache.get(guildConfig.role);
      const underageRole = interaction.guild.roles.cache.get(guildConfig.underage_role);

      // 🔒 LOCK USER
      await pool.query(
        "INSERT INTO verified_users (user_id, guild_id) VALUES ($1, $2)",
        [interaction.user.id, interaction.guild.id]
      );

      if (age < guildConfig.min_age) {
        if (underageRole) await interaction.member.roles.add(underageRole);

        return interaction.reply({
          content: "❌ You are marked as underage.",
          ephemeral: true
        });
      }

      if (verifiedRole) await interaction.member.roles.add(verifiedRole);

      return interaction.reply({
        content: "✅ You are verified!",
        ephemeral: true
      });
    }
  }
});

client.login(TOKEN);
