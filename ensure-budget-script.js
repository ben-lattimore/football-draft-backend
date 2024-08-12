const mongoose = require('mongoose');
const User = require('./models/User'); // Adjust the path as needed
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('Could not connect to MongoDB', err));

async function ensureBudgetField() {
    try {
        const users = await User.find({});
        console.log(`Total users found: ${users.length}`);

        for (const user of users) {
            if (user.budget === undefined) {
                console.log(`Adding budget field for user: ${user.username}`);
                user.budget = 100; // Set default budget
                await user.save();
            } else {
                console.log(`User ${user.username} already has budget: ${user.budget}`);
            }
        }

        console.log('Finished ensuring budget field for all users');
    } catch (error) {
        console.error('Error ensuring budget field:', error);
    } finally {
        mongoose.connection.close();
    }
}

ensureBudgetField();