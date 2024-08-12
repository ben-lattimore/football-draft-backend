const mongoose = require('mongoose');
const User = require('./models/User'); // Adjust the path as needed
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('Could not connect to MongoDB', err));

async function logAllBudgets() {
    try {
        const users = await User.find({});
        console.log(`Total users found: ${users.length}`);

        for (const user of users) {
            console.log(`User: ${user.username}, Budget: ${user.budget}, Budget Type: ${typeof user.budget}`);
        }

    } catch (error) {
        console.error('Error logging budgets:', error);
    } finally {
        mongoose.connection.close();
    }
}

logAllBudgets();