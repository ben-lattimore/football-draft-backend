const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    position_id: {
        type: Number
    },
    position: {
        type: String
    },
    player_image: {
        type: String
    },
    club: {
        type: String
    },
    club_logo: {
        type: String
    }
}, { strict: false });  // This allows for additional fields in your JSON that aren't defined in the schema

module.exports = mongoose.model('Player', playerSchema);