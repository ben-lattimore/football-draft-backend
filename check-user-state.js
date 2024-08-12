const mongoose = require('mongoose');
const User = require('./models/User'); // Adjust the path as needed
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('Could not connect to MongoDB', err));

async function checkUserState() {
    try {
        const user = await User.findOne({ username: 'admin' }).lean();
        if (user) {
            console.log('User state:', JSON.stringify(user, null, 2));
            console.log('Budget:', user.budget);
            console.log('Total spent:', user.wonPlayers.reduce((total, player) => total + player.amount, 0));
        } else {
            console.log('User not found');
        }
    } catch (error) {
        console.error('Error checking user state:', error);
    } finally {
        mongoose.connection.close();
    }
}

checkUserState();