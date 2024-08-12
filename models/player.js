const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    position: {
        type: String,
        required: true
    },
    player_image: {
        type: String
    },
    country: {
        type: String
    }
});

module.exports = mongoose.model('Player', playerSchema);