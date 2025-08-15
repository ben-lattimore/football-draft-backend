const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String },
    hashed_password: { type: String, required: true },
    budget_remaining: { type: Number, default: 100000000 }, // Budget in pence (£100M = 100,000,000 pence)
    budget_spent: { type: Number, default: 0 },
    team_composition: {
        goalkeepers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }],
        defenders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }],
        midfielders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }],
        forwards: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }]
    },
    is_admin: { type: Boolean, default: false },
    is_active: { type: Boolean, default: true },
    // Keep legacy fields for backwards compatibility during migration
    isAdmin: { type: Boolean, default: false },
    initialBudget: { type: Number, default: 100 },
    wonPlayers: [{
        player: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
        amount: { type: Number, required: true },
        auctionDate: { type: Date, default: Date.now }
    }]
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

UserSchema.pre('save', async function(next) {
    // Handle both old and new password fields
    if (this.isModified('password') && this.password) {
        this.hashed_password = await bcrypt.hash(this.password, 10);
        this.password = undefined; // Clear the plain password
    } else if (this.isModified('hashed_password') && this.hashed_password && !this.hashed_password.startsWith('$2b$')) {
        this.hashed_password = await bcrypt.hash(this.hashed_password, 10);
    }
    next();
});

UserSchema.methods.comparePassword = async function(candidatePassword) {
    // Try both password fields for backwards compatibility
    if (this.hashed_password) {
        return bcrypt.compare(candidatePassword, this.hashed_password);
    } else if (this.password) {
        return bcrypt.compare(candidatePassword, this.password);
    }
    return false;
};

const User = mongoose.model('User', UserSchema);

module.exports = User;