const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
    player_id: { type: Number, required: true, unique: true },
    web_name: { type: String, required: true }, // Display name (e.g., "Raya")
    first_name: { type: String, required: true },
    second_name: { type: String, required: true }, // Full name (e.g., "Raya Martín")
    team_id: { type: Number, required: true },
    team_name: { type: String, required: true }, // e.g., "Arsenal"
    team_short_name: { type: String, required: true }, // e.g., "ARS"
    position: { type: String, required: true }, // e.g., "GK", "DEF", "MID", "FWD"
    element_type: { type: Number, required: true }, // Position ID (1=GK, 2=DEF, 3=MID, 4=FWD)
    now_cost: { type: Number, required: true }, // Current FPL cost
    total_points: { type: Number, default: 0 }, // Total FPL points
    form: { type: String, default: "0.0" }, // Recent form rating
    selected_by_percent: { type: String, default: "0.0" }, // Selection percentage
    minutes: { type: Number, default: 0 }, // Minutes played
    goals_scored: { type: Number, default: 0 },
    assists: { type: Number, default: 0 },
    clean_sheets: { type: Number, default: 0 },
    photo_url: { type: String }, // Player photo URL
    
    
    // Legacy fields for backwards compatibility
    name: { type: String }, // For backwards compatibility
    player_image: { type: String }, // For backwards compatibility
    country: { type: String }, // For backwards compatibility
    club: { type: String } // For backwards compatibility
});

// Virtual field to get full name
playerSchema.virtual('full_name').get(function() {
    return `${this.first_name} ${this.second_name}`;
});

// Virtual field for backwards compatibility
playerSchema.virtual('display_name').get(function() {
    return this.name || this.web_name || this.full_name;
});

module.exports = mongoose.model('Player', playerSchema);
