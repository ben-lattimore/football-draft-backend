const mongoose = require('mongoose');
require('dotenv').config();

const PlayerSchema = new mongoose.Schema({
    name: String,
    position: String,
    player_image: String,
    country: String,
    inBin: { type: Boolean, default: false }
});

const Player = mongoose.model('Player', PlayerSchema);

async function updatePlayers() {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('Connected to MongoDB');

        const result = await Player.updateMany(
            { inBin: { $exists: false } },
            { $set: { inBin: false } }
        );

        console.log(`Updated ${result.nModified} players`);
    } catch (error) {
        console.error('Error updating players:', error);
    } finally {
        await mongoose.connection.close();
        console.log('MongoDB connection closed');
    }
}

updatePlayers();