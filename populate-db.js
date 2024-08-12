const mongoose = require('mongoose');
const Player = require('./models/player');
const playersData = require('./players.json');  // Make sure this points to your new JSON file
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('Could not connect to MongoDB', err));

const importData = async () => {
    try {
        await Player.deleteMany();
        console.log('Existing data deleted');

        const formattedPlayers = playersData.map(player => ({
            name: player.name,
            position: player.position.toLowerCase(),  // Lowercase for consistency
            player_image: player.imageUrl,
            country: player.country
        }));

        const insertResult = await Player.insertMany(formattedPlayers);
        console.log(`${insertResult.length} players imported successfully`);

        // Log a few samples to verify data
        const samples = await Player.find().limit(5);
        console.log('Sample of imported data:', samples);

        process.exit();
    } catch (error) {
        console.error('Error importing data:', error);
        process.exit(1);
    }
};

importData();