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

// User Model
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    initialBudget: { type: Number, default: 100 },
    wonPlayers: [{
        player: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
        amount: { type: Number, required: true },
        auctionDate: { type: Date, default: Date.now }
    }]
});

UserSchema.pre('save', async function(next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }
    next();
});

UserSchema.methods.comparePassword = async function(candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', UserSchema);

// Player Model
const PlayerSchema = new mongoose.Schema({
    name: String,
    position: String,
    club: String,
    player_image: String,
    inBin: { type: Boolean, default: false }
});

const Player = mongoose.model('Player', PlayerSchema);

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
                isAdmin: user.isAdmin
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Login failed', error: error.message });
    }
});

// New route to get players in the bin
app.get('/api/players/bin', async (req, res) => {
    try {
        const binPlayers = await Player.find({ inBin: true });
        res.json(binPlayers);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching bin players', error: error.message });
    }
});

// Update the existing players route to exclude bin players
app.get('/api/players', async (req, res) => {
    try {
        const players = await Player.find({ inBin: false });
        res.json(players);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching players', error: error.message });
    }
});

app.get('/api/teams', async (req, res) => {
    try {
        const teams = await User.find({})
            .select('-password')
            .populate({
                path: 'wonPlayers.player',
                model: 'Player',
                select: 'name position club player_image'
            });
        res.json(teams);
    } catch (error) {
        console.error('Error fetching teams:', error);
        res.status(500).json({ message: 'Error fetching teams', error: error.message });
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

        const totalSpent = user.wonPlayers.reduce((total, player) => total + player.amount, 0);
        const calculatedBudget = Math.max(user.initialBudget - totalSpent, 0);

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
let players = [];
let currentPlayerIndex = -1;
let allBids = []; // New array to store all bids for the current auction

// Function to get the next player
const getNextPlayer = () => {
    if (players.length === 0) {
        console.log('No players available');
        return null;
    }
    currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
    return players[currentPlayerIndex];
};

// Replace the existing loadPlayers function with this:
const loadPlayers = async () => {
    try {
        players = await Player.find();
        // Shuffle the players array
        for (let i = players.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [players[i], players[j]] = [players[j], players[i]];
        }
        console.log(`Loaded and shuffled ${players.length} players`);
    } catch (error) {
        console.error('Error loading players:', error);
        players = [];
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
        socket.isAdmin = user.isAdmin;
        console.log(`User connected: ${user.username}, Admin: ${user.isAdmin}`);

        // Send current auction state to newly connected client
        socket.emit('auctionState', { currentPlayer, currentBid, auctionActive, allBids });

        socket.on('startAuction', () => {
            console.log('Received startAuction event');
            if (!socket.isAdmin) {
                console.log('Unauthorized attempt to start auction');
                return socket.emit('error', { message: 'Unauthorized' });
            }
            currentPlayer = getNextPlayer();
            if (!currentPlayer) {
                console.log('No players available for auction');
                return socket.emit('error', { message: 'No players available for auction' });
            }
            currentBid = null;
            auctionActive = true;
            allBids = []; // Reset all bids for the new auction
            io.emit('auctionStarted', { player: currentPlayer, currentBid, allBids });
            console.log('Auction started for player:', currentPlayer.name);
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

                        winner.wonPlayers.push({
                            player: currentPlayer._id,
                            amount: currentBid.amount,
                            auctionDate: new Date()
                        });

                        await winner.save();

                        const totalSpent = winner.wonPlayers.reduce((total, player) => total + player.amount, 0);
                        const newBudget = Math.max(winner.initialBudget - totalSpent, 0);

                        await session.commitTransaction();
                        console.log('Database update successful. Updated user:', JSON.stringify(winner.toObject(), null, 2));
                        console.log('New calculated budget:', newBudget);
                        io.emit('auctionStopped', {
                            winner: currentBid.bidder,
                            amount: currentBid.amount,
                            player: currentPlayer.name,
                            newBudget: newBudget,
                            allBids: allBids
                        });
                        console.log(`Auction stopped. Winner: ${currentBid.bidder}, Player: ${currentPlayer.name}, Amount: ${currentBid.amount}, New Budget: ${newBudget}`);
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
                console.log('Auction stopped with no winner. Moving player to bin.');
                try {
                    await Player.findByIdAndUpdate(currentPlayer._id, { inBin: true });
                    io.emit('auctionStopped', { winner: null, amount: null, player: currentPlayer.name, allBids: allBids, movedToBin: true });
                } catch (error) {
                    console.error('Error moving player to bin:', error);
                    socket.emit('error', { message: 'Error updating player status: ' + error.message });
                }
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

                const totalSpent = user.wonPlayers.reduce((total, player) => total + player.amount, 0);
                const currentBudget = Math.max(user.initialBudget - totalSpent, 0);

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