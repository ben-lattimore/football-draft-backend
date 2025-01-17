const express = require('express');
const router = express.Router();
const Player = require('../models/player');

router.get('/', async (req, res) => {
    console.log('GET request received at /api/players');
    try {
        const players = await Player.find();
        console.log(`Found ${players.length} players`);
        res.json(players);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching players', error: error.message });
    }
});

module.exports = router;