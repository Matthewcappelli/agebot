const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  SlashCommandBuilder,
  Routes,
  REST
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

// 🧱 Create table
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_config (
      guild_id TEXT PRIMARY KEY,
      channel TEXT,
      role TEXT,
      min_age INT
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

    return { channel: null, role: null, min_age: 13 };
  }

  return res.rows[0];
}

// ⚡ SLASH COMMANDS
const commands = [
  new SlashCommandBuilder()
    .setName('setverifychannel')
    .setDescription('Set verification channel')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Channel')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('setverifyrole')
    .setDescription('Set verification role')
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('Role')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('setminage')
    .setDescription('Set minimum age')
    .addIntegerOption(option =>
      option.setName('age')
        .setDescription('Minimum age')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('sendverify')
    .setDescription('Send verification message'),

  new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Start verification')
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

// 🎯 Handle commands
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const guildConfig = await getConfig(interaction.guild.id);

  // 🔒 Admin check
  const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

  // SET CHANNEL
  if (interaction.commandName === 'setverifychannel') {
    if (!isAdmin) return interaction.reply({ content: "❌ Admin only", ephemeral: true });

    const channel = interaction.options.getChannel('channel');

    await pool.query(
      "UPDATE guild_config SET channel = $1 WHERE guild_id = $2",
      [channel.id, interaction.guild.id]
    );

    return interaction.reply(`✅ Channel set to ${channel}`);
  }

  // SET ROLE
  if (interaction.commandName === 'setverifyrole') {
    if (!isAdmin) return interaction.reply({ content: "❌ Admin only", ephemeral: true });

    const role = interaction.options.getRole('role');

    await pool.query(
      "UPDATE guild_config SET role = $1 WHERE guild_id = $2",
      [role.id, interaction.guild.id]
    );

    return interaction.reply(`✅ Role set to ${role.name}`);
  }

  // SET AGE
  if (interaction.commandName === 'setminage') {
    if (!isAdmin) return interaction.reply({ content: "❌ Admin only", ephemeral: true });

    const age = interaction.options.getInteger('age');

    await pool.query(
      "UPDATE guild_config SET min_age = $1 WHERE guild_id = $2",
      [age, interaction.guild.id]
    );

    return interaction.reply(`✅ Min age set to ${age}`);
  }

  // SEND VERIFY MESSAGE
  if (interaction.commandName === 'sendverify') {
    if (!isAdmin) return interaction.reply({ content: "❌ Admin only", ephemeral: true });

    if (!guildConfig.channel) {
      return interaction.reply("❌ Set channel first");
    }

    const channel = interaction.guild.channels.cache.get(guildConfig.channel);

    await channel.send("🔐 **Verification Required**\nUse `/verify` to begin.");

    return interaction.reply({ content: "✅ Sent", ephemeral: true });
  }

  // VERIFY
  if (interaction.commandName === 'verify') {
    if (interaction.channel.id !== guildConfig.channel) return;

    if (!guildConfig.role) {
      return interaction.reply("⚠️ Role not set");
    }

    await interaction.reply("📩 Type your age in chat.");

    const filter = m => m.author.id === interaction.user.id;

    const collector = interaction.channel.createMessageCollector({
      filter,
      time: 30000,
      max: 1
    });

    collector.on('collect', async (msg) => {
      const age = parseInt(msg.content);

      if (isNaN(age)) {
        return msg.reply("❌ Invalid number");
      }

      if (age < guildConfig.min_age) {
        return msg.reply("❌ Not old enough");
      }

      const role = interaction.guild.roles.cache.get(guildConfig.role);

      await msg.member.roles.add(role);

      msg.reply("✅ Verified!");
    });
  }
});

client.login(TOKEN);