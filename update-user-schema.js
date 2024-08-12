const mongoose = require('mongoose');
const User = require('./models/User'); // Adjust the path as needed
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('Could not connect to MongoDB', err));

async function updateUserSchema() {
    try {
        const users = await User.find({});
        console.log(`Found ${users.length} users`);

        for (const user of users) {
            console.log(`Updating user: ${user.username}`);

            if (!user.initialBudget) {
                user.initialBudget = 100;
            }

            // Remove the old budget field if it exists
            if (user.budget !== undefined) {
                delete user.budget;
            }

            await user.save();
            console.log(`Updated user: ${user.username}`);
            console.log('New user object:', user.toObject());
            console.log('--------------------');
        }

        console.log('Finished updating user schema');
    } catch (error) {
        console.error('Error updating user schema:', error);
    } finally {
        mongoose.connection.close();
    }
}

updateUserSchema();