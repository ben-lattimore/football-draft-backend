const mongoose = require('mongoose');
require('dotenv').config();

const PlayerSchema = new mongoose.Schema({
    name: String,
    position: String,
    club: String,
    player_image: String,
    inBin: { type: Boolean, default: false }
});

const Player = mongoose.model('Player', PlayerSchema);

async function resetPlayers() {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('Connected to MongoDB');

        const result = await Player.updateMany({}, { inBin: false });
        console.log(`Reset ${result.nModified} players`);
    } catch (error) {
        console.error('Error resetting players:', error);
    } finally {
        await mongoose.connection.close();
        console.log('MongoDB connection closed');
    }
}

resetPlayers();