require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

const DB_PATH = path.join(__dirname, 'database.json');

// Helper to interact with the JSON DB
function readDB() {
    try {
        if (!fs.existsSync(DB_PATH)) {
            fs.writeFileSync(DB_PATH, JSON.stringify({}, null, 2));
        }
        const data = fs.readFileSync(DB_PATH, 'utf8');
        return JSON.parse(data || '{}');
    } catch (err) {
        console.error("Error reading database:", err);
        return {};
    }
}

function writeDB(data) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("Error writing to database:", err);
    }
}

// Endpoint: Register a new Strong Box metadata
app.post('/api/strongbox', (req, res) => {
    try {
        const { 
            ownerWallet, 
            strongBoxAddress, 
            guardian1Address, guardian1Email, 
            guardian2Address, guardian2Email, 
            heir1Address, heir1Email, 
            heir2Address, heir2Email, 
            ownerEmail,
            timeLimit
        } = req.body;

        if (!strongBoxAddress) {
            return res.status(400).json({ error: "strongBoxAddress is required" });
        }

        const db = readDB();

        // Key by strongBoxAddress for easier role validations
        db[strongBoxAddress.toLowerCase()] = {
            owner: ownerWallet.toLowerCase(),
            ownerEmail,
            guardians: {
                [guardian1Address.toLowerCase()]: guardian1Email,
                [guardian2Address.toLowerCase()]: guardian2Email
            },
            heirs: {
                [heir1Address.toLowerCase()]: heir1Email,
                [heir2Address.toLowerCase()]: heir2Email
            },
            timeLimit,
            createdAt: new Date().toISOString()
        };

        writeDB(db);

        console.log(`Successfully registered StrongBox metadata for address: ${strongBoxAddress}`);
        res.status(201).json({ message: "StrongBox metadata saved successfully." });
    } catch (error) {
        console.error("Error saving StrongBox:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Endpoint: Retrieves StrongBox profile by Owner's wallet (or connected wallet)
// Because we keyed by StrongBoxAddress, we iterate to find the owner's box.
app.get('/api/strongbox/owner/:wallet', (req, res) => {
    try {
        const wallet = req.params.wallet.toLowerCase();
        const db = readDB();
        
        let foundData = null;
        let foundAddress = null;

        for (const [sbAddress, data] of Object.entries(db)) {
            if (data.owner === wallet) {
                foundData = data;
                foundAddress = sbAddress;
                break;
            }
        }

        if (!foundData) {
            return res.status(404).json({ error: "StrongBox metadata not found for this wallet" });
        }

        res.status(200).json({ strongBoxAddress: foundAddress, ...foundData });
    } catch (error) {
        console.error("Error fetching StrongBox metadata:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Endpoint: Validates the role of a wallet in a specific StrongBox
app.get('/api/strongbox/validate/:address/:wallet', (req, res) => {
    try {
        const address = req.params.address.toLowerCase().trim();
        const wallet = req.params.wallet.toLowerCase().trim();
        
        const db = readDB();
        const box = db[address];

        if (!box) {
            return res.status(404).json({ error: "StrongBox not found in Database" });
        }

        let roles = [];
        if (box.owner === wallet) {
            roles.push("owner");
        } 
        if (box.guardians && box.guardians.hasOwnProperty(wallet)) {
            roles.push("guardian");
        } 
        if (box.heirs && box.heirs.hasOwnProperty(wallet)) {
            roles.push("heir");
        }

        let primaryRole = roles.length > 0 ? roles[0] : "none";

        res.status(200).json({ role: primaryRole, roles: roles });
    } catch (error) {
        console.error("Error validating role:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// A simple health check
app.get('/', (req, res) => {
    res.send('StrongBox API is up and running.');
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
