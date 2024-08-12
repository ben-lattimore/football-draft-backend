const mongoose = require('mongoose');
const User = require('./models/User'); // Adjust the path as needed
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('Could not connect to MongoDB', err));

async function addBudgetToExistingUsers() {
    try {
        const result = await User.updateMany(
            { budget: { $exists: false } },
            { $set: { budget: 100 } }
        );
        console.log(`Updated ${result.nModified} users with a budget of 100`);
    } catch (error) {
        console.error('Error updating users:', error);
    } finally {
        mongoose.connection.close();
    }
}

addBudgetToExistingUsers();