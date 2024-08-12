const mongoose = require('mongoose');
const User = require('./models/User'); // Adjust the path as needed
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('Could not connect to MongoDB', err));

async function clearWonPlayers() {
    try {
        const result = await User.updateMany({}, { $set: { wonPlayers: [] } });
        console.log(`Cleared wonPlayers for ${result.modifiedCount} users`);
    } catch (error) {
        console.error('Error clearing wonPlayers:', error);
    } finally {
        mongoose.connection.close();
    }
}

clearWonPlayers();