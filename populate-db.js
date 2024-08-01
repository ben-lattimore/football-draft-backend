const mongoose = require('mongoose');
const Player = require('./models/player');
const playersData = require('./players_2.json');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('Could not connect to MongoDB', err));

const positionMapping = {
    24: 'goalkeeper',
    25: 'defender',
    26: 'midfielder',
    27: 'attacker'
};

const importData = async () => {
    try {
        await Player.deleteMany();
        console.log('Existing data deleted');

        const playersWithPosition = playersData.map(player => ({
            ...player,
            position: positionMapping[player.position_id] || 'unknown'
        }));

        const insertResult = await Player.insertMany(playersWithPosition);
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