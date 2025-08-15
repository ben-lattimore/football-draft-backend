const mongoose = require('mongoose');
require('dotenv').config();

// Import the updated models
const User = require('./models/User');
const Player = require('./models/player');

async function testNewDatabase() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('Connected to MongoDB');

        // Test Player queries
        console.log('\n--- Testing Player Model ---');
        const samplePlayer = await Player.findOne();
        if (samplePlayer) {
            console.log('Sample player found:', {
                id: samplePlayer._id,
                name: samplePlayer.name || samplePlayer.web_name,
                position: samplePlayer.position,
                team: samplePlayer.team_name || samplePlayer.club,
                fpl_cost: samplePlayer.now_cost,
                total_points: samplePlayer.total_points
            });
        } else {
            console.log('No players found in database');
        }

        const totalPlayers = await Player.countDocuments();
        console.log(`Total players in database: ${totalPlayers}`);

        // Test User queries
        console.log('\n--- Testing User Model ---');
        const sampleUser = await User.findOne();
        if (sampleUser) {
            console.log('Sample user found:', {
                id: sampleUser._id,
                username: sampleUser.username,
                is_admin: sampleUser.is_admin || sampleUser.isAdmin,
                budget_remaining: sampleUser.budget_remaining,
                legacy_budget: sampleUser.initialBudget
            });
        } else {
            console.log('No users found in database');
        }

        const totalUsers = await User.countDocuments();
        console.log(`Total users in database: ${totalUsers}`);

        // Test budget calculation logic
        if (sampleUser) {
            console.log('\n--- Testing Budget Logic ---');
            let calculatedBudget;
            if (sampleUser.budget_remaining !== undefined) {
                calculatedBudget = sampleUser.budget_remaining / 1000000;
                console.log(`New schema budget: £${calculatedBudget}M`);
            } else {
                const totalSpent = sampleUser.wonPlayers?.reduce((total, player) => total + player.amount, 0) || 0;
                calculatedBudget = Math.max((sampleUser.initialBudget || 100) - totalSpent, 0);
                console.log(`Legacy schema budget: £${calculatedBudget}M`);
            }
        }

        console.log('\n✅ Database connection and model compatibility test completed successfully!');

    } catch (error) {
        console.error('❌ Error testing database:', error);
    } finally {
        await mongoose.connection.close();
        console.log('Database connection closed');
    }
}

// Run the test
testNewDatabase();
