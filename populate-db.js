const mongoose = require('mongoose');
const Player = require('./models/player');
const playersData = require('./players.json');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('Could not connect to MongoDB', err));

const importData = async () => {
    try {
        // Clear existing players
        await Player.deleteMany({});
        console.log('Existing data deleted');

        // Insert new players, ensuring inBin is set to false
        const formattedPlayers = playersData.map(player => ({
            ...player,
            inBin: false  // Explicitly set to false
        }));

        const insertResult = await Player.insertMany(formattedPlayers);
        console.log(`${insertResult.length} players imported successfully`);

        // Log a few samples to verify data
        const samples = await Player.find().limit(5);
        console.log('Sample of imported data:');
        samples.forEach(player => {
            console.log({
                name: player.name,
                position: player.position,
                player_image: player.player_image,
                country: player.country,
                inBin: player.inBin
            });
        });

        // Count total players
        const totalCount = await Player.countDocuments();
        console.log(`Total players in database: ${totalCount}`);

        // Verify inBin field
        const inBinCount = await Player.countDocuments({ inBin: true });
        const notInBinCount = await Player.countDocuments({ inBin: false });
        console.log(`Players with inBin true: ${inBinCount}`);
        console.log(`Players with inBin false: ${notInBinCount}`);

    } catch (error) {
        console.error('Error importing data:', error);
    } finally {
        await mongoose.connection.close();
        console.log('MongoDB connection closed');
        process.exit();
    }
};

importData();