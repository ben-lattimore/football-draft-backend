const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
// Near the top of your server.js file
const allowedOrigins = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : [];

// Then update your corsOptions
const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            var msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

// Use the corsOptions in your app configuration
app.use(cors(corsOptions));

const io = new Server(server, {
    cors: corsOptions,
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 5001;

// Middleware
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
    console.log(`${req.method} request for ${req.url}`);
    next();
});

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => {
        console.log('Connected to MongoDB Atlas');
        loadPlayers();
    })
    .catch((err) => console.error('Could not connect to MongoDB', err));

// Import models
const User = require('./models/User');
const Player = require('./models/player');

// Auth Routes
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password, isAdmin } = req.body;
        const user = new User({ username, password, isAdmin: isAdmin || false });
        await user.save();
        res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
        res.status(400).json({ message: 'Registration failed', error: error.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ message: 'User not found' });
        }
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.json({
            token,
            user: {
                username: user.username,
                isAdmin: user.isAdmin || user.is_admin
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Login failed', error: error.message });
    }
});

// Get all players
app.get('/api/players', async (req, res) => {
    try {
        const players = await Player.find({});
        res.json(players);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching players', error: error.message });
    }
});

// Search for players (available for auction)
app.get('/api/players/search', async (req, res) => {
    try {
        const { q } = req.query;
        
        if (!q || q.length < 2) {
            return res.status(400).json({ message: 'Search query must be at least 2 characters long' });
        }
        
        // Get currently won player IDs
        let currentWonPlayerIds;
        try {
            currentWonPlayerIds = await getWonPlayers();
        } catch (error) {
            console.warn('Error getting won players, using empty set:', error);
            currentWonPlayerIds = new Set();
        }
        
        // Search for players by name (case insensitive)
        const searchRegex = new RegExp(q, 'i');
        const searchResults = await Player.find({
            $or: [
                { web_name: searchRegex },
                { first_name: searchRegex },
                { second_name: searchRegex },
                { 'search_fields.full_name': searchRegex }
            ]
        }).select('_id web_name first_name second_name position team_name team_short_name now_cost total_points photo_url')
          .limit(20); // Limit to 20 results
        
        // Filter out already won players
        const availablePlayers = searchResults.filter(player => {
            if (!player._id) return false;
            return !currentWonPlayerIds.has(player._id.toString());
        });
        
        res.json({
            query: q,
            results: availablePlayers,
            total: availablePlayers.length
        });
    } catch (error) {
        console.error('Error searching players:', error);
        res.status(500).json({ message: 'Error searching players', error: error.message });
    }
});

// Get a random high-value player (from top 50 available)
app.get('/api/players/random', async (req, res) => {
    try {
        // Get currently won player IDs
        let currentWonPlayerIds;
        try {
            currentWonPlayerIds = await getWonPlayers();
        } catch (error) {
            console.warn('Error getting won players, using empty set:', error);
            currentWonPlayerIds = new Set();
        }
        
        // Get all players sorted by cost (highest first) and filter out won players
        const availablePlayers = await Player.find({
            _id: { $nin: Array.from(currentWonPlayerIds) }
        })
        .sort({ now_cost: -1 }) // Highest cost first
        .limit(50) // Top 50 highest value
        .select('_id web_name first_name second_name position team_name team_short_name now_cost total_points photo_url');
        
        if (availablePlayers.length === 0) {
            return res.status(404).json({ message: 'No available high-value players found' });
        }
        
        // Select a random player from the top 50
        const randomIndex = Math.floor(Math.random() * availablePlayers.length);
        const randomPlayer = availablePlayers[randomIndex];
        
        console.log(`Selected random player: ${randomPlayer.web_name || randomPlayer.first_name + ' ' + randomPlayer.second_name} from ${availablePlayers.length} top available players`);
        
        res.json({
            player: randomPlayer,
            totalAvailable: availablePlayers.length,
            selectedFrom: 'Top 50 highest value available players'
        });
    } catch (error) {
        console.error('Error getting random player:', error);
        res.status(500).json({ message: 'Error getting random player', error: error.message });
    }
});

// Admin authentication middleware
const authenticateAdmin = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user || (!user.isAdmin && !user.is_admin)) {
            return res.status(403).json({ message: 'Admin access required' });
        }
        req.user = user;
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Invalid token' });
    }
};

// User Management API Endpoints

// Player Management API Endpoints

// Get all players (Admin only) with optional filters
app.get('/api/admin/players', authenticateAdmin, async (req, res) => {
    try {
        const { search, position } = req.query;
        let query = {};

        // Apply filters if provided
        if (search) {
            const searchRegex = new RegExp(search, 'i');
            query.$or = [
                { web_name: searchRegex },
                { first_name: searchRegex },
                { second_name: searchRegex },
                { team_name: searchRegex }
            ];
        }

        if (position) {
            query.position = position.toUpperCase();
        }

        const players = await Player.find(query)
            .sort({ web_name: 1 })
            .select('_id web_name first_name second_name position team_name team_short_name now_cost photo_url');

        res.json(players);
    } catch (error) {
        console.error('Error fetching players for admin:', error);
        res.status(500).json({ message: 'Error fetching players', error: error.message });
    }
});

// Create new player (Admin only)
app.post('/api/admin/players', authenticateAdmin, async (req, res) => {
    try {
        const { web_name, first_name, second_name, position, team_name, team_short_name = '', now_cost = 10 } = req.body;

        // Basic validation
        if (!web_name || !first_name || !second_name || !position || !team_name) {
            return res.status(400).json({ message: 'Required fields are missing' });
        }

        // Generate a unique player_id (using timestamp + random number)
        const player_id = Date.now() + Math.floor(Math.random() * 1000);

        // Create the new player
        const player = new Player({
            player_id,
            web_name,
            first_name,
            second_name,
            position: position.toUpperCase(),
            team_name,
            team_short_name: team_short_name || team_name.substring(0, 3).toUpperCase(),
            now_cost: parseInt(now_cost) || 10,
            team_id: 0, // Default value
            element_type: position === 'GK' ? 1 : position === 'DEF' ? 2 : position === 'MID' ? 3 : 4, // Map position to element_type
            total_points: 0,
            // Set other required fields with default values
            form: "0.0",
            selected_by_percent: "0.0",
            minutes: 0
        });

        await player.save();

        res.status(201).json({
            message: 'Player created successfully',
            player: {
                _id: player._id,
                web_name: player.web_name,
                first_name: player.first_name,
                second_name: player.second_name,
                position: player.position,
                team_name: player.team_name
            }
        });
    } catch (error) {
        console.error('Error creating player:', error);
        res.status(400).json({ message: 'Error creating player', error: error.message });
    }
});

// Update player (Admin only)
app.put('/api/admin/players/:id', authenticateAdmin, async (req, res) => {
    try {
        const { web_name, first_name, second_name, position, team_name } = req.body;
        const playerId = req.params.id;

        // Basic validation
        if (!web_name || !first_name || !second_name || !position || !team_name) {
            return res.status(400).json({ message: 'Required fields are missing' });
        }

        // Create update object with only the fields we want to update
        const updateData = {
            web_name,
            first_name,
            second_name,
            position: position.toUpperCase(),
            team_name,
            // Update legacy fields for backwards compatibility
            name: web_name,
            club: team_name
        };

        // Handle team_short_name update
        if (req.body.team_short_name) {
            updateData.team_short_name = req.body.team_short_name;
        } else if (team_name) {
            // Auto-generate if not provided
            updateData.team_short_name = team_name.substring(0, 3).toUpperCase();
        }

        // Update element_type based on position if position changed
        if (position) {
            updateData.element_type = position === 'GK' ? 1 : position === 'DEF' ? 2 : position === 'MID' ? 3 : 4;
        }

        const player = await Player.findByIdAndUpdate(
            playerId,
            updateData,
            { new: true, runValidators: true }
        ).select('_id web_name first_name second_name position team_name');

        if (!player) {
            return res.status(404).json({ message: 'Player not found' });
        }

        res.json({ message: 'Player updated successfully', player });
    } catch (error) {
        console.error('Error updating player:', error);
        res.status(400).json({ message: 'Error updating player', error: error.message });
    }
});

// Delete player (Admin only)
app.delete('/api/admin/players/:id', authenticateAdmin, async (req, res) => {
    try {
        const playerId = req.params.id;

        // Check if the player has been won by any user
        const usersWithPlayer = await User.countDocuments({
            'wonPlayers.player': playerId
        });

        if (usersWithPlayer > 0) {
            return res.status(400).json({ 
                message: 'Cannot delete player: This player has been won by one or more users. Remove the player from users first.' 
            });
        }

        const player = await Player.findByIdAndDelete(playerId);

        if (!player) {
            return res.status(404).json({ message: 'Player not found' });
        }

        res.json({ message: 'Player deleted successfully' });
    } catch (error) {
        console.error('Error deleting player:', error);
        res.status(500).json({ message: 'Error deleting player', error: error.message });
    }
});

// Get all users (Admin only)
app.get('/api/admin/users', authenticateAdmin, async (req, res) => {
    try {
        const users = await User.find({})
            .select('-hashed_password -password')
            .populate('wonPlayers.player', 'web_name position team_name');
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching users', error: error.message });
    }
});

// Create new user (Admin only)
app.post('/api/admin/users', authenticateAdmin, async (req, res) => {
    try {
        console.log('=== CREATE USER REQUEST ===');
        console.log('Request body:', req.body);
        console.log('Admin user:', req.user.username);
        
        const { username, password, email, isAdmin } = req.body;
        
        // Validation
        if (!username || !password) {
            console.log('Validation failed: missing username or password');
            return res.status(400).json({ message: 'Username and password are required' });
        }
        
        if (password.length < 6) {
            console.log('Validation failed: password too short');
            return res.status(400).json({ message: 'Password must be at least 6 characters long' });
        }
        
        // Check if user exists
        console.log('Checking if user exists:', username);
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            console.log('User already exists:', username);
            return res.status(400).json({ message: 'Username already exists' });
        }
        
        console.log('Creating new user...');
        const user = new User({
            username,
            email: email || null, // Convert empty string to null
            hashed_password: password, // Will be hashed by pre-save hook
            is_admin: isAdmin || false,
            isAdmin: isAdmin || false // Keep both for compatibility
        });
        
        console.log('Saving user to database...');
        await user.save();
        console.log('User saved successfully:', user._id);
        
        res.status(201).json({ 
            message: 'User created successfully',
            user: { 
                _id: user._id,
                username: user.username, 
                email: user.email,
                is_admin: user.is_admin,
                isAdmin: user.isAdmin
            }
        });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(400).json({ message: 'Error creating user', error: error.message });
    }
});

// Update user (Admin only)
app.put('/api/admin/users/:id', authenticateAdmin, async (req, res) => {
    try {
        const { username, password, email, isAdmin } = req.body;
        const userId = req.params.id;
        
        // Prevent admin from removing their own admin status
        if (userId === req.user._id.toString() && isAdmin === false) {
            return res.status(400).json({ message: 'Cannot remove your own admin privileges' });
        }
        
        const updateData = {};
        if (username && username.trim()) updateData.username = username.trim();
        if (email !== undefined) updateData.email = email;
        if (isAdmin !== undefined) {
            updateData.is_admin = isAdmin;
            updateData.isAdmin = isAdmin;
        }
        
        // Handle password update separately
        if (password && password.trim()) {
            if (password.length < 6) {
                return res.status(400).json({ message: 'Password must be at least 6 characters long' });
            }
            const hashedPassword = await bcrypt.hash(password, 10);
            updateData.hashed_password = hashedPassword;
        }
        
        const user = await User.findByIdAndUpdate(
            userId,
            updateData,
            { new: true, runValidators: true }
        ).select('-hashed_password -password');
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        res.json({ message: 'User updated successfully', user });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Username already exists' });
        }
        res.status(400).json({ message: 'Error updating user', error: error.message });
    }
});

// Delete user (Admin only)
app.delete('/api/admin/users/:id', authenticateAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        
        // Prevent admin from deleting themselves
        if (userId === req.user._id.toString()) {
            return res.status(400).json({ message: 'Cannot delete your own account' });
        }
        
        // Check if this is the last admin
        const adminCount = await User.countDocuments({ 
            $or: [{ is_admin: true }, { isAdmin: true }] 
        });
        
        const userToDelete = await User.findById(userId);
        if (!userToDelete) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        if ((userToDelete.is_admin || userToDelete.isAdmin) && adminCount <= 1) {
            return res.status(400).json({ message: 'Cannot delete the last admin user' });
        }
        
        await User.findByIdAndDelete(userId);
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting user', error: error.message });
    }
});

// Get a random player from top 10 highest value by position
app.get('/api/players/random/:position', async (req, res) => {
    try {
        const { position } = req.params;
        
        // Validate position parameter and normalize GKP to GK
        const validPositions = ['GK', 'GKP', 'DEF', 'MID', 'FWD'];
        if (!validPositions.includes(position.toUpperCase())) {
            return res.status(400).json({ message: 'Invalid position. Must be one of: GK, GKP, DEF, MID, FWD' });
        }
        
        // Normalize GKP to GK for database query
        const normalizedPosition = position.toUpperCase() === 'GKP' ? 'GKP' : position.toUpperCase();
        
        // Get currently won player IDs
        let currentWonPlayerIds;
        try {
            currentWonPlayerIds = await getWonPlayers();
        } catch (error) {
            console.warn('Error getting won players, using empty set:', error);
            currentWonPlayerIds = new Set();
        }
        
        // Get players by position, filtered by availability, sorted by cost (highest first)
        // Handle GK -> GKP mapping
        const searchPosition = position.toUpperCase() === 'GK' ? 'GKP' : position.toUpperCase();
        const availablePlayers = await Player.find({
            position: searchPosition,
            _id: { $nin: Array.from(currentWonPlayerIds) }
        })
        .sort({ now_cost: -1 }) // Highest cost first
        .limit(10) // Top 10 highest value for this position
        .select('_id web_name first_name second_name position team_name team_short_name now_cost total_points photo_url');
        
        if (availablePlayers.length === 0) {
            return res.status(404).json({ 
                message: `No available ${position.toUpperCase()} players found`,
                position: position.toUpperCase()
            });
        }
        
        // Select a random player from the top 10 of this position
        const randomIndex = Math.floor(Math.random() * availablePlayers.length);
        const randomPlayer = availablePlayers[randomIndex];
        
        console.log(`Selected random ${position.toUpperCase()} player: ${randomPlayer.web_name || randomPlayer.first_name + ' ' + randomPlayer.second_name} from top ${availablePlayers.length} available`);
        
        res.json({
            player: randomPlayer,
            position: position.toUpperCase(),
            totalAvailableInPosition: availablePlayers.length,
            selectedFrom: `Top ${availablePlayers.length} highest value available ${position.toUpperCase()} players`
        });
    } catch (error) {
        console.error('Error getting random player by position:', error);
        res.status(500).json({ message: 'Error getting random player by position', error: error.message });
    }
});

// Get players that have been won in auctions
app.get('/api/players/won', async (req, res) => {
    try {
        const users = await User.find({})
            .populate({
                path: 'wonPlayers.player',
                model: 'Player',
                select: '_id web_name first_name second_name position team_name team_short_name now_cost total_points photo_url'
            })
            .select('username wonPlayers');
        
        const wonPlayers = [];
        users.forEach(user => {
            if (user.wonPlayers && user.wonPlayers.length > 0) {
                user.wonPlayers.forEach(wonPlayer => {
                    if (wonPlayer.player) {
                        wonPlayers.push({
                            player: wonPlayer.player,
                            winner: user.username,
                            amount: wonPlayer.amount,
                            auctionDate: wonPlayer.auctionDate
                        });
                    }
                });
            }
        });
        
        // Sort by auction date (most recent first)
        wonPlayers.sort((a, b) => new Date(b.auctionDate) - new Date(a.auctionDate));
        
        res.json({
            players: wonPlayers,
            total: wonPlayers.length
        });
    } catch (error) {
        console.error('Error fetching won players:', error);
        res.status(500).json({ message: 'Error fetching won players', error: error.message });
    }
});

// Get players that have never been put up for auction
app.get('/api/players/remaining', async (req, res) => {
    try {
        // Get all won player IDs
        const wonPlayerIds = await getWonPlayers();
        
        // For now, we'll consider remaining players as those not won and not currently in auction
        // In a more complete implementation, we'd track auctionedPlayerIds properly
        const remainingPlayers = await Player.find({
            _id: { $nin: Array.from(wonPlayerIds) }
        })
        .select('_id web_name first_name second_name position team_name team_short_name now_cost total_points photo_url')
        .sort({ now_cost: -1 }); // Sort by value (highest first)
        
        res.json({
            players: remainingPlayers,
            total: remainingPlayers.length
        });
    } catch (error) {
        console.error('Error fetching remaining players:', error);
        res.status(500).json({ message: 'Error fetching remaining players', error: error.message });
    }
});

// Get players that were auctioned but received no bids
app.get('/api/players/not-bid-on', async (req, res) => {
    try {
        // For now, return empty array as we need to implement tracking
        // In the future, this would query noBidPlayerIds set or a database collection
        const noBidPlayers = [];
        
        if (noBidPlayerIds && noBidPlayerIds.size > 0) {
            const playerIdsArray = Array.from(noBidPlayerIds);
            const players = await Player.find({
                _id: { $in: playerIdsArray }
            })
            .select('_id web_name first_name second_name position team_name team_short_name now_cost total_points photo_url');
            
            noBidPlayers.push(...players);
        }
        
        res.json({
            players: noBidPlayers,
            total: noBidPlayers.length
        });
    } catch (error) {
        console.error('Error fetching players with no bids:', error);
        res.status(500).json({ message: 'Error fetching players with no bids', error: error.message });
    }
});

app.get('/api/teams', async (req, res) => {
    try {
        const teams = await User.find({})
            .select('-hashed_password -password')
            .populate({
                path: 'wonPlayers.player',
                model: 'Player',
                select: '_id web_name first_name second_name position team_name team_short_name now_cost total_points photo_url name player_image club country'
            });
        
        // Calculate budgets and format team data
        const formattedTeams = teams.map(team => {
            // Calculate remaining budget using new system, fall back to legacy
            let remainingBudget;
            if (team.budget_remaining !== undefined) {
                // New system: budget in pence, convert to millions
                remainingBudget = team.budget_remaining / 1000000;
            } else {
                // Legacy system: calculate from wonPlayers
                const totalSpent = team.wonPlayers?.reduce((total, player) => total + player.amount, 0) || 0;
                remainingBudget = Math.max((team.initialBudget || 100) - totalSpent, 0);
            }
            
            return {
                _id: team._id,
                username: team.username,
                isAdmin: team.isAdmin || team.is_admin,
                wonPlayers: team.wonPlayers || [],
                remainingBudget: remainingBudget,
                totalSpent: team.wonPlayers?.reduce((total, player) => total + player.amount, 0) || 0,
                playerCount: team.wonPlayers?.length || 0
            };
        });
        
        res.json(formattedTeams);
    } catch (error) {
        console.error('Error fetching teams:', error);
        res.status(500).json({ message: 'Error fetching teams', error: error.message });
    }
});

// Reset auction data endpoints
app.post('/api/admin/reset-auction', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ message: 'No token provided' });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ message: 'Invalid token' });
        }

        const user = await User.findById(decoded.userId);
        if (!user || !(user.isAdmin || user.is_admin)) {
            return res.status(403).json({ message: 'Admin access required' });
        }

        console.log('Starting full auction reset...');
        
        // Reset all users' auction data
        const userResetResult = await User.updateMany({}, {
            $set: {
                wonPlayers: [],
                budget_remaining: 100 * 1000000, // 100m in pence
                budget_spent: 0,
                'team_composition.goalkeepers': [],
                'team_composition.defenders': [],
                'team_composition.midfielders': [],
                'team_composition.forwards': []
            }
        });

        console.log(`Reset auction data for ${userResetResult.modifiedCount} users`);
        
        // Clear in-memory auction state
        currentPlayer = null;
        currentBid = null;
        auctionActive = false;
        allBids = [];
        selectedAuctionPlayer = null;
        wonPlayerIds = new Set();
        auctionedPlayerIds = new Set();
        noBidPlayerIds = new Set();
        
        console.log('Cleared in-memory auction state');
        
        res.json({ 
            message: 'Auction reset successfully',
            usersReset: userResetResult.modifiedCount,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error resetting auction:', error);
        res.status(500).json({ message: 'Error resetting auction', error: error.message });
    }
});

app.post('/api/admin/reset-budgets-only', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ message: 'No token provided' });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ message: 'Invalid token' });
        }

        const user = await User.findById(decoded.userId);
        if (!user || !(user.isAdmin || user.is_admin)) {
            return res.status(403).json({ message: 'Admin access required' });
        }

        console.log('Resetting user budgets only...');
        
        // Reset only budgets, keep wonPlayers
        const budgetResetResult = await User.updateMany({}, {
            $set: {
                budget_remaining: 100 * 1000000, // 100m in pence
                budget_spent: 0
            }
        });

        console.log(`Reset budgets for ${budgetResetResult.modifiedCount} users`);
        
        res.json({ 
            message: 'User budgets reset to £100m successfully',
            usersReset: budgetResetResult.modifiedCount,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error resetting budgets:', error);
        res.status(500).json({ message: 'Error resetting budgets', error: error.message });
    }
});

app.post('/api/admin/clear-won-players', async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ message: 'No token provided' });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ message: 'Invalid token' });
        }

        const user = await User.findById(decoded.userId);
        if (!user || !(user.isAdmin || user.is_admin)) {
            return res.status(403).json({ message: 'Admin access required' });
        }

        console.log('Clearing won players only...');
        
        // Clear only won players and team composition, keep budgets
        const clearResult = await User.updateMany({}, {
            $set: {
                wonPlayers: [],
                'team_composition.goalkeepers': [],
                'team_composition.defenders': [],
                'team_composition.midfielders': [],
                'team_composition.forwards': []
            }
        });

        // Clear in-memory tracking
        wonPlayerIds = new Set();
        auctionedPlayerIds = new Set();
        noBidPlayerIds = new Set();

        console.log(`Cleared won players for ${clearResult.modifiedCount} users`);
        
        res.json({ 
            message: 'Won players cleared successfully',
            usersReset: clearResult.modifiedCount,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error clearing won players:', error);
        res.status(500).json({ message: 'Error clearing won players', error: error.message });
    }
});

app.get('/api/user/budget', async (req, res) => {
    console.log('Received request for user budget');
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            console.log('No token provided in budget request');
            return res.status(401).json({ message: 'No token provided' });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
            console.log('Decoded token:', decoded);
        } catch (err) {
            console.error('Token verification failed:', err);
            return res.status(401).json({ message: 'Invalid token' });
        }

        if (!decoded.userId) {
            console.error('Decoded token does not contain userId');
            return res.status(400).json({ message: 'Invalid token structure' });
        }

        console.log('Attempting to find user with ID:', decoded.userId);
        const user = await User.findById(decoded.userId);

        if (!user) {
            console.log('User not found in database');
            return res.status(404).json({ message: 'User not found' });
        }

        // Handle both old and new budget systems
        let calculatedBudget;
        if (user.budget_remaining !== undefined) {
            // New schema: budget stored directly
            calculatedBudget = user.budget_remaining / 1000000; // Convert from pence to millions
        } else {
            // Old schema: calculate from wonPlayers
            const totalSpent = user.wonPlayers?.reduce((total, player) => total + player.amount, 0) || 0;
            calculatedBudget = Math.max((user.initialBudget || 100) - totalSpent, 0);
        }

        console.log('User details:', user.toObject());
        console.log('Calculated Budget:', calculatedBudget);
        console.log('Budget type:', typeof calculatedBudget);

        const response = { budget: calculatedBudget };
        console.log('Sending budget response:', response);
        res.json(response);
    } catch (error) {
        console.error('Error fetching user budget:', error);
        res.status(500).json({ message: 'Error fetching user budget', error: error.message });
    }
});

// Auction state
let currentPlayer = null;
let currentBid = null;
let auctionActive = false;
let players = []; // Available players for auction
let allPlayersSorted = []; // All players sorted by cost (for replenishing pool)
let wonPlayerIds = new Set(); // Track players that have been won
let allBids = []; // New array to store all bids for the current auction
let selectedAuctionPlayer = null; // Manually selected player for next auction
let auctionedPlayerIds = new Set(); // Track players that have been put up for auction
let noBidPlayerIds = new Set(); // Track players that were auctioned but received no bids


// Function to get all won players from database
const getWonPlayers = async () => {
    try {
        const users = await User.find({}).select('wonPlayers');
        const wonIds = new Set();
        users.forEach(user => {
            if (user.wonPlayers) {
                user.wonPlayers.forEach(wonPlayer => {
                    wonIds.add(wonPlayer.player.toString());
                });
            }
        });
        return wonIds;
    } catch (error) {
        console.error('Error getting won players:', error);
        return new Set();
    }
};

// Function to replenish the auction pool
const replenishPlayerPool = async () => {
    try {
        // Update our won players set
        wonPlayerIds = await getWonPlayers();
        
        // Get currently used player IDs from the existing pool
        const currentPoolIds = new Set(players.map(p => p._id ? p._id.toString() : '').filter(id => id));
        
        // Filter out won players and already-pooled players from the sorted list
        const availablePlayers = allPlayersSorted.filter(player => {
            // Skip players without _id (corrupted data)
            if (!player._id) {
                console.warn('Player found without _id:', player);
                return false;
            }
            
            const playerId = player._id.toString();
            return !wonPlayerIds.has(playerId) && !currentPoolIds.has(playerId);
        });
        
        // Take next 20 highest available players and shuffle them
        const nextPlayers = availablePlayers.slice(0, 20);
        
        // Shuffle the new players
        for (let i = nextPlayers.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [nextPlayers[i], nextPlayers[j]] = [nextPlayers[j], nextPlayers[i]];
        }
        
        // Add to existing player pool
        players.push(...nextPlayers);
        
        console.log(`Added ${nextPlayers.length} new players to auction pool`);
        console.log(`Total available players: ${availablePlayers.length}`);
        console.log(`Current auction pool size: ${players.length}`);
        if (nextPlayers.length > 0) {
            const minCost = nextPlayers.reduce((min, p) => Math.min(min, p.now_cost || 0), Infinity);
            const maxCost = nextPlayers.reduce((max, p) => Math.max(max, p.now_cost || 0), 0);
            console.log(`Replenished players cost range: £${minCost / 10}m to £${maxCost / 10}m`);
        }
        
        return nextPlayers.length > 0;
    } catch (error) {
        console.error('Error replenishing player pool:', error);
        return false;
    }
};

// Function to get the next player
const getNextPlayer = async () => {
    // If admin has selected a specific player, use that first
    if (selectedAuctionPlayer) {
        // Validate the selected player is still available (not won)
        wonPlayerIds = await getWonPlayers();
        if (!wonPlayerIds.has(selectedAuctionPlayer._id.toString())) {
            console.log(`Using admin-selected player: ${selectedAuctionPlayer.web_name || selectedAuctionPlayer.name}`);
            const player = selectedAuctionPlayer;
            selectedAuctionPlayer = null; // Clear selection after use
            return player;
        } else {
            console.log(`Admin-selected player ${selectedAuctionPlayer.web_name || selectedAuctionPlayer.name} has been won, falling back to normal selection`);
            selectedAuctionPlayer = null; // Clear invalid selection
        }
    }
    
    // Remove the current player if it exists (they were just auctioned)
    if (currentPlayer && currentPlayer._id) {
        players = players.filter(p => p._id && p._id.toString() !== currentPlayer._id.toString());
    }
    
    // If we're running low on players, replenish the pool
    if (players.length < 5) {
        console.log('Running low on players, replenishing pool...');
        await replenishPlayerPool();
    }
    
    if (players.length === 0) {
        console.log('No players available');
        return null;
    }
    
    // Get the next player from the pool
    return players[0];
};

// Load and sort all players initially
const loadPlayers = async () => {
    try {
        // Fetch all players from database
        const allPlayers = await Player.find();
        
        // Sort players by now_cost in descending order (highest cost first)
        allPlayersSorted = allPlayers.sort((a, b) => {
            const costA = a.now_cost || 0;
            const costB = b.now_cost || 0;
            return costB - costA;
        });
        
        // Get currently won players
        wonPlayerIds = await getWonPlayers();
        
        // Initial pool of top available players
        await replenishPlayerPool();
        
        console.log(`Loaded ${allPlayersSorted.length} total players`);
        console.log(`${wonPlayerIds.size} players already won`);
        console.log(`Initial auction pool: ${players.length} players`);
        if (players.length > 0) {
            console.log(`Auction players range from £${(players[0]?.now_cost || 0) / 10}m to £${(players[players.length - 1]?.now_cost || 0) / 10}m`);
        }
    } catch (error) {
        console.error('Error loading players:', error);
        players = [];
        allPlayersSorted = [];
    }
};


// Socket.IO with authentication
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('Authentication error: No token provided'));
    }
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            console.error('JWT verification error:', err);
            return next(new Error('Authentication error: Invalid token'));
        }
        socket.userId = decoded.userId;
        next();
    });
});

io.on('connection', async (socket) => {
    console.log('New client connected, ID:', socket.id);

    try {
        const user = await User.findById(socket.userId);
        if (!user) {
            throw new Error('User not found');
        }
        socket.isAdmin = user.isAdmin || user.is_admin;
        console.log(`User connected: ${user.username}, Admin: ${socket.isAdmin}`);

        // Send current auction state to newly connected client
        socket.emit('auctionState', { 
            currentPlayer, 
            currentBid, 
            auctionActive, 
            allBids
        });

        socket.on('startAuction', async () => {
            console.log('Received startAuction event');
            if (!socket.isAdmin) {
                console.log('Unauthorized attempt to start auction');
                return socket.emit('error', { message: 'Unauthorized' });
            }
            
            try {
                currentPlayer = await getNextPlayer();
                if (!currentPlayer) {
                    console.log('No players available for auction');
                    return socket.emit('error', { message: 'No players available for auction' });
                }
                currentBid = null;
                auctionActive = true;
                allBids = []; // Reset all bids for the new auction
                
                io.emit('auctionStarted', { 
                    player: currentPlayer, 
                    currentBid, 
                    allBids
                });
                console.log('Auction started for player:', currentPlayer.name || currentPlayer.web_name || currentPlayer.display_name);
            } catch (error) {
                console.error('Error starting auction:', error);
                socket.emit('error', { message: 'Error starting auction' });
            }
        });

        socket.on('stopAuction', async () => {
            console.log('Received stopAuction event');
            if (!socket.isAdmin) {
                console.log('Unauthorized attempt to stop auction');
                return socket.emit('error', { message: 'Unauthorized' });
            }
            auctionActive = false;
            if (currentBid && currentPlayer) {
                try {
                    console.log('Current player:', currentPlayer);
                    console.log('Current bid:', currentBid);
                    const session = await mongoose.startSession();
                    session.startTransaction();
                    try {
                        const winner = await User.findOne({ username: currentBid.bidder }).session(session);

                        if (!winner) {
                            console.log('Winner not found in database');
                            throw new Error('Winner not found');
                        }

                        // Update legacy wonPlayers for backward compatibility
                        winner.wonPlayers.push({
                            player: currentPlayer._id,
                            amount: currentBid.amount,
                            auctionDate: new Date()
                        });

                        // Update new budget fields
                        const bidAmountInPence = currentBid.amount * 1000000; // Convert from millions to pence
                        winner.budget_remaining -= bidAmountInPence;
                        winner.budget_spent += bidAmountInPence;

                        // Add player to appropriate team composition based on position
                        const playerPosition = currentPlayer.position;
                        if (playerPosition === 'GK' || playerPosition === 'GKP') {
                            winner.team_composition.goalkeepers.push(currentPlayer._id);
                        } else if (playerPosition === 'DEF') {
                            winner.team_composition.defenders.push(currentPlayer._id);
                        } else if (playerPosition === 'MID') {
                            winner.team_composition.midfielders.push(currentPlayer._id);
                        } else if (playerPosition === 'FWD') {
                            winner.team_composition.forwards.push(currentPlayer._id);
                        }

                        await winner.save();

                        // Calculate budget for response (both new and legacy)
                        const newBudgetInMillions = winner.budget_remaining / 1000000; // Convert back to millions
                        const totalSpent = winner.wonPlayers.reduce((total, player) => total + player.amount, 0);
                        const legacyBudget = Math.max(winner.initialBudget - totalSpent, 0);

                        await session.commitTransaction();
                        console.log('Database update successful. Updated user:', JSON.stringify(winner.toObject(), null, 2));
                        console.log('New calculated budget:', newBudgetInMillions);
                        
                        // Immediately update in-memory pool to prevent the same player from appearing again
                        // This happens here because currentPlayer is still defined (before reset at end)
                        const wonIdStr = currentPlayer?._id?.toString();
                        if (wonIdStr) {
                            console.log(`Won player: ${currentPlayer.web_name || currentPlayer.name} (${wonIdStr})`);
                            if (!wonPlayerIds) wonPlayerIds = new Set();
                            wonPlayerIds.add(wonIdStr);
                            const before = players.length;
                            players = players.filter(p => p && p._id && p._id.toString() !== wonIdStr);
                            const after = players.length;
                            console.log(`Removed won player from pool. Size: ${before} -> ${after}`);
                            
                            // Also remove from allPlayersSorted for defensive programming
                            allPlayersSorted = allPlayersSorted.filter(p => p && p._id && p._id.toString() !== wonIdStr);
                            
                            // Replenish pool if needed
                            try {
                                if (typeof replenishPlayerPool === 'function' && players.length < 5) {
                                    console.log('Replenishing player pool after win...');
                                    await replenishPlayerPool();
                                    console.log(`Pool replenished. New size: ${players.length}`);
                                }
                            } catch (e) {
                                console.error('Error replenishing pool after win:', e);
                            }
                        }
                        
                        io.emit('auctionStopped', {
                            winner: currentBid.bidder,
                            amount: currentBid.amount,
                            player: currentPlayer.name || currentPlayer.web_name || currentPlayer.display_name,
                            newBudget: newBudgetInMillions,
                            allBids: allBids
                        });
                        console.log(`Auction stopped. Winner: ${currentBid.bidder}, Player: ${currentPlayer.name || currentPlayer.web_name || currentPlayer.display_name}, Amount: ${currentBid.amount}, New Budget: ${newBudgetInMillions}`);
                    } catch (error) {
                        console.error('Error in transaction, aborting:', error);
                        await session.abortTransaction();
                        throw error;
                    } finally {
                        session.endSession();
                    }
                } catch (error) {
                    console.error('Error saving won player:', error);
                    socket.emit('error', { message: 'Error saving auction result: ' + error.message });
                }
            } else {
                console.log('Auction stopped with no winner.');
                
                // Track player that was auctioned but received no bids
                if (currentPlayer && currentPlayer._id) {
                    const playerId = currentPlayer._id.toString();
                    noBidPlayerIds.add(playerId);
                    console.log(`Added player ${currentPlayer.web_name || currentPlayer.name} to no-bid list`);
                }
                
                io.emit('auctionStopped', { winner: null, amount: null, player: currentPlayer.name || currentPlayer.web_name || currentPlayer.display_name, allBids: allBids });
            }
            
            currentPlayer = null;
            currentBid = null;
            allBids = [];
        });

        socket.on('placeBid', async (bid) => {
            console.log('Received placeBid event', bid);
            if (!auctionActive) {
                console.log('Attempt to place bid when auction is not active');
                return socket.emit('error', { message: 'Auction is not active' });
            }

            try {
                const user = await User.findOne({ username: bid.bidder });
                console.log('User found for bid:', user ? user.username : 'Not found');
                if (!user) {
                    return socket.emit('error', { message: 'User not found' });
                }

                // Calculate current budget using new system, fall back to legacy
                let currentBudget;
                if (user.budget_remaining !== undefined) {
                    // New system: budget in pence, convert to millions for comparison
                    currentBudget = user.budget_remaining / 1000000;
                } else {
                    // Legacy system: calculate from wonPlayers
                    const totalSpent = user.wonPlayers.reduce((total, player) => total + player.amount, 0);
                    currentBudget = Math.max(user.initialBudget - totalSpent, 0);
                }

                console.log('User budget:', currentBudget, 'Bid amount:', bid.amount);
                if (bid.amount > currentBudget) {
                    return socket.emit('error', { message: 'Bid exceeds your available budget' });
                }

                if (!currentBid || bid.amount > currentBid.amount) {
                    currentBid = bid;
                    allBids.push({ ...bid, timestamp: new Date() }); // Add the new bid to allBids with a timestamp
                    console.log('New bid accepted:', bid);
                    io.emit('newBid', { currentBid: bid, allBids: allBids });
                } else {
                    console.log('Bid rejected: not higher than current bid');
                    socket.emit('error', { message: 'Your bid must be higher than the current bid' });
                }
            } catch (error) {
                console.error('Error processing bid:', error);
                socket.emit('error', { message: 'An error occurred while processing your bid' });
            }
        });

        socket.on('setAuctionPlayer', async (data) => {
            console.log('Received setAuctionPlayer event', data);
            if (!socket.isAdmin) {
                console.log('Unauthorized attempt to set auction player');
                return socket.emit('error', { message: 'Unauthorized: Only admins can set auction players' });
            }

            if (auctionActive) {
                console.log('Cannot set auction player while auction is active');
                return socket.emit('error', { message: 'Cannot set auction player while an auction is active' });
            }

            try {
                const { playerId } = data;
                if (!playerId) {
                    return socket.emit('error', { message: 'Player ID is required' });
                }

                // Find the player in the database
                const player = await Player.findById(playerId);
                if (!player) {
                    return socket.emit('error', { message: 'Player not found' });
                }

                // Check if player has already been won
                wonPlayerIds = await getWonPlayers();
                if (wonPlayerIds.has(playerId)) {
                    return socket.emit('error', { message: 'This player has already been won by someone else' });
                }

                // Set the selected player for the next auction
                selectedAuctionPlayer = player;
                console.log(`Admin selected player for next auction: ${player.web_name || player.name} (${playerId})`);
                
                // Notify the admin that the player has been selected
                socket.emit('auctionPlayerSet', {
                    player: {
                        _id: player._id,
                        web_name: player.web_name,
                        first_name: player.first_name,
                        second_name: player.second_name,
                        position: player.position,
                        team_name: player.team_name,
                        now_cost: player.now_cost,
                        photo_url: player.photo_url
                    },
                    message: `${player.web_name || player.name} has been selected for the next auction`
                });
                
            } catch (error) {
                console.error('Error setting auction player:', error);
                socket.emit('error', { message: 'Error setting auction player: ' + error.message });
            }
        });

        socket.on('setRandomAuctionPlayerByPosition', async (data) => {
            console.log('Received setRandomAuctionPlayerByPosition event', data);
            if (!socket.isAdmin) {
                console.log('Unauthorized attempt to set random auction player by position');
                return socket.emit('error', { message: 'Unauthorized: Only admins can set random auction players' });
            }

            if (auctionActive) {
                console.log('Cannot set random auction player while auction is active');
                return socket.emit('error', { message: 'Cannot set random auction player while an auction is active' });
            }

            try {
                const { position } = data;
                
                // Validate position parameter
                const validPositions = ['GK', 'DEF', 'MID', 'FWD'];
                if (!position || !validPositions.includes(position.toUpperCase())) {
                    return socket.emit('error', { message: 'Invalid position. Must be one of: GK, DEF, MID, FWD' });
                }
                
                // Get currently won player IDs
                wonPlayerIds = await getWonPlayers();
                
                // Get players by position, filtered by availability, sorted by cost (highest first)
                const availablePlayers = await Player.find({
                    position: position.toUpperCase(),
                    _id: { $nin: Array.from(wonPlayerIds) }
                })
                .sort({ now_cost: -1 }) // Highest cost first
                .limit(10) // Top 10 highest value for this position
                .select('_id web_name first_name second_name position team_name team_short_name now_cost total_points photo_url');
                
                if (availablePlayers.length === 0) {
                    return socket.emit('error', { 
                        message: `No available ${position.toUpperCase()} players found for random selection`,
                        position: position.toUpperCase()
                    });
                }
                
                // Select a random player from the top 10 of this position
                const randomIndex = Math.floor(Math.random() * availablePlayers.length);
                const randomPlayer = availablePlayers[randomIndex];
                
                // Set the random player for the next auction
                selectedAuctionPlayer = randomPlayer;
                console.log(`Admin selected random ${position.toUpperCase()} player: ${randomPlayer.web_name || randomPlayer.name} from top ${availablePlayers.length} available`);
                
                // Format position name for display
                const positionNames = {
                    'GK': 'Goalkeeper',
                    'DEF': 'Defender',
                    'MID': 'Midfielder',
                    'FWD': 'Forward'
                };
                const positionName = positionNames[position.toUpperCase()] || position.toUpperCase();
                
                // Notify the admin that the random player has been selected
                socket.emit('auctionPlayerSet', {
                    player: {
                        _id: randomPlayer._id,
                        web_name: randomPlayer.web_name,
                        first_name: randomPlayer.first_name,
                        second_name: randomPlayer.second_name,
                        position: randomPlayer.position,
                        team_name: randomPlayer.team_name,
                        now_cost: randomPlayer.now_cost,
                        photo_url: randomPlayer.photo_url
                    },
                    message: `Random ${positionName}: ${randomPlayer.web_name || randomPlayer.name} (from top ${availablePlayers.length} available) selected for auction`,
                    isRandom: true,
                    position: position.toUpperCase(),
                    totalAvailableInPosition: availablePlayers.length
                });
                
            } catch (error) {
                console.error('Error setting random auction player by position:', error);
                socket.emit('error', { message: 'Error setting random auction player by position: ' + error.message });
            }
        });

        socket.on('setRandomAuctionPlayer', async () => {
            console.log('Received setRandomAuctionPlayer event');
            if (!socket.isAdmin) {
                console.log('Unauthorized attempt to set random auction player');
                return socket.emit('error', { message: 'Unauthorized: Only admins can set random auction players' });
            }

            if (auctionActive) {
                console.log('Cannot set random auction player while auction is active');
                return socket.emit('error', { message: 'Cannot set random auction player while an auction is active' });
            }

            try {
                // Get currently won player IDs
                wonPlayerIds = await getWonPlayers();
                
                // Get all available players (any position), filtered by availability
                const availablePlayers = await Player.find({
                    _id: { $nin: Array.from(wonPlayerIds) }
                })
                .select('_id web_name first_name second_name position team_name team_short_name now_cost total_points photo_url');
                
                if (availablePlayers.length === 0) {
                    return socket.emit('error', { 
                        message: 'No available players found for random selection'
                    });
                }
                
                // Select a completely random player from all available players
                const randomIndex = Math.floor(Math.random() * availablePlayers.length);
                const randomPlayer = availablePlayers[randomIndex];
                
                // Set the random player for the next auction
                selectedAuctionPlayer = randomPlayer;
                console.log(`Admin selected random banter player: ${randomPlayer.web_name || randomPlayer.name} from ${availablePlayers.length} total available`);
                
                // Format position name for display
                const positionNames = {
                    'GK': 'Goalkeeper',
                    'DEF': 'Defender',
                    'MID': 'Midfielder',
                    'FWD': 'Forward'
                };
                const positionName = positionNames[randomPlayer.position] || randomPlayer.position;
                
                // Notify the admin that the random player has been selected
                socket.emit('auctionPlayerSet', {
                    player: {
                        _id: randomPlayer._id,
                        web_name: randomPlayer.web_name,
                        first_name: randomPlayer.first_name,
                        second_name: randomPlayer.second_name,
                        position: randomPlayer.position,
                        team_name: randomPlayer.team_name,
                        now_cost: randomPlayer.now_cost,
                        photo_url: randomPlayer.photo_url
                    },
                    message: `Banter Pick: ${randomPlayer.web_name || randomPlayer.name} (${positionName}) selected for auction (from ${availablePlayers.length} total available)`,
                    isRandom: true,
                    isBanter: true,
                    totalAvailable: availablePlayers.length
                });
                
            } catch (error) {
                console.error('Error setting random auction player:', error);
                socket.emit('error', { message: 'Error setting random auction player: ' + error.message });
            }
        });

        socket.on('disconnect', (reason) => {
            console.log(`Client disconnected. ID: ${socket.id}, Reason: ${reason}`);
        });
    } catch (error) {
        console.error('Error in socket connection:', error);
        socket.emit('error', { message: 'An error occurred during connection setup' });
        socket.disconnect(true);
    }
});

// Start the server
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});