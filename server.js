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

// CORS configuration
const corsOptions = {
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

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
        console.log('Connected to MongoDB Atlas:', process.env.MONGODB_URI);
        loadPlayers();
    })
    .catch((err) => console.error('Could not connect to MongoDB', err));

// User Model
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    wonPlayers: [{
        player: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
        amount: { type: Number, required: true },
        auctionDate: { type: Date, default: Date.now }
    }]
});

UserSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 10);
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
    player_image: String
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

// Player routes
app.get('/api/players', async (req, res) => {
    try {
        const players = await Player.find();
        res.json(players);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching players', error: error.message });
    }
});

// Auction state
let currentPlayer = null;
let currentBid = null;
let auctionActive = false;
let players = [];
let currentPlayerIndex = -1;

// Function to get the next player
const getNextPlayer = () => {
    if (players.length === 0) {
        console.log('No players available');
        return null;
    }
    currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
    return players[currentPlayerIndex];
};

// Load players from the database
const loadPlayers = async () => {
    try {
        players = await Player.find().sort({ name: 1 });
        console.log(`Loaded ${players.length} players`);
    } catch (error) {
        console.error('Error loading players:', error);
        players = []; // Ensure players is an empty array if there's an error
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
        socket.emit('auctionState', { currentPlayer, currentBid, auctionActive });

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
            io.emit('auctionStarted', { player: currentPlayer, currentBid });
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
                    console.log('Attempting to update user in database:', {
                        username: currentBid.bidder,
                        playerId: currentPlayer._id,
                        amount: currentBid.amount
                    });
                    const session = await mongoose.startSession();
                    session.startTransaction();
                    try {
                        const winner = await User.findOneAndUpdate(
                            { username: currentBid.bidder },
                            {
                                $push: {
                                    wonPlayers: {
                                        player: currentPlayer._id,
                                        amount: currentBid.amount,
                                        auctionDate: new Date()
                                    }
                                }
                            },
                            { new: true, session }
                        );
                        if (!winner) {
                            console.log('Winner not found in database');
                            throw new Error('Winner not found');
                        }
                        await session.commitTransaction();
                        console.log('Database update successful. Updated user:', winner);
                        io.emit('auctionStopped', {
                            winner: currentBid.bidder,
                            amount: currentBid.amount,
                            player: currentPlayer.name
                        });
                        console.log(`Auction stopped. Winner: ${currentBid.bidder}, Player: ${currentPlayer.name}, Amount: ${currentBid.amount}`);
                    } catch (error) {
                        await session.abortTransaction();
                        throw error;
                    } finally {
                        session.endSession();
                    }
                } catch (error) {
                    console.error('Error saving won player:', error);
                    socket.emit('error', { message: 'Error saving auction result' });
                }
            } else {
                io.emit('auctionStopped', { winner: null, amount: null, player: null });
                console.log('Auction stopped. No winner.');
            }
            currentPlayer = null;
            currentBid = null;
        });

        socket.on('placeBid', (bid) => {
            console.log('Received placeBid event', bid);
            if (!auctionActive) {
                console.log('Attempt to place bid when auction is not active');
                return socket.emit('error', { message: 'Auction is not active' });
            }
            if (!currentBid || bid.amount > currentBid.amount) {
                currentBid = bid;
                console.log('New bid accepted:', bid);
                io.emit('newBid', bid);
            } else {
                console.log('Bid rejected: not higher than current bid');
                socket.emit('error', { message: 'Your bid must be higher than the current bid' });
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