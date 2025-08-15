const User = require('./models/User');
const mongoose = require('mongoose');
require('dotenv').config();

async function testLogin() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        
        const user = await User.findOne({ username: 'benji' });
        if (!user) {
            console.log('User benji not found');
            return;
        }
        
        console.log('User benji details:');
        console.log({
            username: user.username,
            email: user.email,
            isAdmin: user.isAdmin,
            is_admin: user.is_admin,
            hasPassword: !!user.password,
            hasHashedPassword: !!user.hashed_password
        });
        
        // Test password comparison
        const testPassword = 'password123!';
        const isMatch = await user.comparePassword(testPassword);
        console.log(`\nPassword '${testPassword}' matches:`, isMatch);
        
        // Test admin field logic
        const adminStatus = user.isAdmin || user.is_admin;
        console.log('Final admin status (isAdmin || is_admin):', adminStatus);
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        mongoose.connection.close();
    }
}

testLogin();
