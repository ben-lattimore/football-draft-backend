# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Common Development Commands

### Running the Application
```bash
# Start the server (production mode)
npm start

# Start with nodemon for development (auto-restart on changes)
npm run dev
```

### Database Management
```bash
# Populate database with player data
node populate-db.js

# Reset all players (remove from bin)
node reset-players.js

# Clear all won players from users
node clear-won-players.js

# Create a new user account
node create-user.js

# Check user state in database
node check-user-state.js
```

### Player Data Management
```bash
# Parse HTML player data into JSON
node parse_players.js

# Update existing players in database
node update-players.js

# Update user schema (for migrations)
node update-user-schema.js
```

## Architecture Overview

### Core Technologies
- **Backend**: Node.js with Express.js server
- **Database**: MongoDB with Mongoose ODM
- **Real-time Communication**: Socket.IO for auction bidding
- **Authentication**: JWT tokens with bcrypt password hashing
- **Deployment**: Heroku-ready with Procfile

### Application Structure

**Single Server Architecture**: The application uses a monolithic server.js file that handles:
- Express HTTP routes for REST API
- Socket.IO real-time bidding system
- Database models and connections
- Authentication middleware
- CORS configuration for cross-origin requests

### Key Models

**User Model** (`models/User.js`):
- Username/password authentication with bcrypt hashing
- Admin role system for auction control
- Budget tracking with `initialBudget` and `wonPlayers`
- Populated wonPlayers array with player references and bid amounts

**Player Model** (`models/player.js`):
- Basic player information (name, position, image, country)
- `inBin` boolean for managing unsold players
- Referenced by User's wonPlayers for auction results

### Auction System Architecture

The auction system is built around Socket.IO real-time communication:

**Auction State Management**:
- `currentPlayer`: The player being auctioned
- `currentBid`: Highest bid with bidder information
- `auctionActive`: Boolean controlling bid acceptance
- `allBids`: Array of all bids for current auction

**Authentication Flow**:
1. JWT token required for Socket.IO connections
2. Token validated in socket middleware
3. User admin status determines auction control permissions

**Bidding Process**:
1. Admin starts auction with `startAuction` event
2. Players place bids via `placeBid` event with budget validation
3. Admin stops auction with `stopAuction` event
4. Winner assignment updates User model with transaction safety

### Environment Configuration

Required environment variables:
- `MONGODB_URI`: MongoDB connection string
- `JWT_SECRET`: Secret key for JWT token signing
- `PORT`: Server port (defaults to 5001)
- `FRONTEND_URL`: Comma-separated allowed CORS origins

### Data Management Scripts

The application includes several utility scripts for data management:
- **Player data parsing**: HTML to JSON conversion for bulk imports
- **Database seeding**: Populate players with `inBin: false` default
- **User management**: Create admin users and clear auction data
- **Migration scripts**: Handle schema updates and budget fixes

### CORS and Cross-Origin Setup

CORS is configured to accept requests from environment-defined frontend URLs with:
- Credentials support for authenticated requests
- Specific allowed headers for API communication
- Support for both REST API and Socket.IO connections

### Real-time Features

Socket.IO handles:
- Live auction state broadcasting to all connected clients
- Bid validation against user budgets
- Admin-only auction control events
- Automatic disconnection handling and error management
