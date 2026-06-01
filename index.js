require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { MongoClient, ObjectId } = require('mongodb');

const uri = process.env.MONGO_URI;
const PORT = process.env.PORT || 5000;
const app = express();

const corsOptions = {
    origin: [
        'http://localhost:3000',
        'https://b-13-assignment-09-2-0.vercel.app',
        'https://b_13_assignment_09-2.0.vercel.app'
    ],
    credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

const client = new MongoClient(uri);

const verifyToken = (req, res, next) => {
    const token = req.cookies?.token;
    if (!token) {
        return res.status(401).send({ success: false, message: "No token found" });
    }

    const secret = process.env.ACCESS_TOKEN_SECRET || "fallback_token_secret_string_pap_key";
    jwt.verify(token, secret, (err, decoded) => {
        if (err) {
            return res.status(401).send({ success: false, message: "Invalid token" });
        }
        req.user = decoded;
        next();
    });
};

async function run() {
    try {
        await client.connect();
        const db = client.db("Pet-Adoption-Platform");
        const petCollection = db.collection("pets");
        const adoptionCollection = db.collection("adoptions");

        app.post('/jwt', (req, res) => {
            const user = req.body;
            if (!user?.email) {
                return res.status(400).send({ success: false, message: "Email is required" });
            }

            const secret = process.env.ACCESS_TOKEN_SECRET || "fallback_token_secret_string_pap_key";
            const token = jwt.sign({ email: user.email }, secret, { expiresIn: '1d' });

            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
                maxAge: 24 * 60 * 60 * 1000
            }).send({ success: true, message: "Logged in successfully" });
        });

        app.post('/logout', (req, res) => {
            res.clearCookie('token', {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
                maxAge: 0
            }).send({ success: true, message: "Logged out" });
        });

        app.get('/pets', async (req, res) => {
            try {
                const { search, species } = req.query;
                let query = {};

                if (search) {
                    query.petName = { $regex: search, $options: 'i' };
                }
                if (species) {
                    query.species = { $in: species.split(',') };
                }

                const result = await petCollection.find(query).toArray();
                res.send(result);
            } catch (error) {
                res.status(500).send({ success: false, message: "Error loading pets" });
            }
        });

        app.get('/pets/:id', async (req, res) => {
            const id = req.params.id;
            if (!ObjectId.isValid(id)) {
                return res.status(400).send({ error: "Invalid ID" });
            }
            try {
                const result = await petCollection.findOne({ _id: new ObjectId(id) });
                if (!result) {
                    return res.status(404).send({ error: "Pet not found" });
                }
                res.send(result);
            } catch (error) {
                res.status(500).send({ error: "Server error" });
            }
        });

        app.post('/pets', verifyToken, async (req, res) => {
            if (req.body.ownerEmail !== req.user.email) {
                return res.status(403).send({ success: false, message: "Forbidden" });
            }
            try {
                const result = await petCollection.insertOne(req.body);
                res.status(201).send(result);
            } catch (error) {
                res.status(500).send({ success: false, message: "Save failed" });
            }
        });

        app.put('/pets/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            if (!ObjectId.isValid(id)) {
                return res.status(400).send({ error: "Invalid ID" });
            }
            try {
                const pet = await petCollection.findOne({ _id: new ObjectId(id) });
                if (!pet) return res.status(404).send({ error: "Pet not found" });
                if (pet.ownerEmail !== req.user.email) {
                    return res.status(403).send({ error: "Unauthorized" });
                }

                const data = { ...req.body };
                delete data._id;

                const result = await petCollection.updateOne({ _id: new ObjectId(id) }, { $set: data });
                res.send(result);
            } catch (error) {
                res.status(500).send({ error: "Update failed" });
            }
        });

        app.delete('/pets/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            if (!ObjectId.isValid(id)) {
                return res.status(400).send({ error: "Invalid ID" });
            }
            try {
                const pet = await petCollection.findOne({ _id: new ObjectId(id) });
                if (!pet) return res.status(404).send({ error: "Pet not found" });
                if (pet.ownerEmail !== req.user.email) {
                    return res.status(403).send({ error: "Unauthorized" });
                }

                const result = await petCollection.deleteOne({ _id: new ObjectId(id) });
                res.send(result);
            } catch (error) {
                res.status(500).send({ error: "Delete failed" });
            }
        });

        app.post('/adoptions', verifyToken, async (req, res) => {
            try {
                const adoptionData = req.body;
                const { petId, userEmail } = adoptionData;
                if (userEmail !== req.user.email) {
                    return res.status(403).send({ message: "Forbidden" });
                }

                const pet = await petCollection.findOne({ _id: new ObjectId(petId) });
                if (!pet) return res.status(404).send({ message: "Pet not found" });
                if (pet.ownerEmail === userEmail) {
                    return res.status(400).send({ message: "You cannot adopt your own pet!" });
                }
                if (pet.status === "adopted") {
                    return res.status(400).send({ message: "Already adopted" });
                }

                const existing = await adoptionCollection.findOne({ petId, userEmail });
                if (existing) {
                    return res.status(400).send({
                        success: false,
                        message: existing.status === "Rejected"
                            ? "Your request was rejected."
                            : `You already have a ${existing.status} request.`
                    });
                }

                const result = await adoptionCollection.insertOne(adoptionData);
                res.status(201).send({ success: true, result });
            } catch (error) {
                res.status(500).send({ message: "Error submitting request" });
            }
        });

        app.get('/adoptions/:petId', verifyToken, async (req, res) => {
            const { petId } = req.params;
            try {
                const pet = await petCollection.findOne({ _id: new ObjectId(petId) });
                if (!pet) return res.status(404).send({ message: "Pet not found" });

                const result = await adoptionCollection.find({ petId }).toArray();
                if (pet.ownerEmail === req.user.email) {
                    res.send(result);
                } else {
                    res.send(result.filter(r => r.userEmail === req.user.email));
                }
            } catch (error) {
                res.status(500).send({ message: "Server error" });
            }
        });

        app.get('/user-adoptions/:email', verifyToken, async (req, res) => {
            if (req.params.email !== req.user.email) {
                return res.status(403).send({ message: "Forbidden" });
            }
            try {
                const result = await adoptionCollection.find({ userEmail: req.params.email }).toArray();
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Server error" });
            }
        });

        app.delete('/adoptions/:id', verifyToken, async (req, res) => {
            const { id } = req.params;
            if (!ObjectId.isValid(id)) {
                return res.status(400).send({ message: "Invalid ID" });
            }
            try {
                const request = await adoptionCollection.findOne({ _id: new ObjectId(id) });
                if (!request) return res.status(404).send({ message: "Not found" });
                if (request.userEmail !== req.user.email) {
                    return res.status(403).send({ message: "Unauthorized" });
                }
                if (request.status === "Approved") {
                    return res.status(400).send({ message: "Cannot cancel approved requests" });
                }

                await adoptionCollection.deleteOne({ _id: new ObjectId(id) });
                res.send({ success: true, message: "Request canceled" });
            } catch (error) {
                res.status(500).send({ message: "Cancel failed" });
            }
        });

        app.patch('/adoptions-status/:id', verifyToken, async (req, res) => {
            const { id } = req.params;
            const { petId, status } = req.body;
            if (!ObjectId.isValid(id) || !ObjectId.isValid(petId)) {
                return res.status(400).send({ message: "Invalid ID format" });
            }

            try {
                const pet = await petCollection.findOne({ _id: new ObjectId(petId) });
                if (!pet) return res.status(404).send({ message: "Pet not found" });
                if (pet.ownerEmail !== req.user.email) {
                    return res.status(403).send({ message: "Unauthorized" });
                }

                if (status === "Approved") {
                    if (pet.status === "adopted") {
                        return res.status(400).send({ message: "Pet is already adopted" });
                    }

                    await adoptionCollection.updateOne({ _id: new ObjectId(id) }, { $set: { status: "Approved" } });
                    await petCollection.updateOne({ _id: new ObjectId(petId) }, { $set: { status: "adopted" } });
                    await adoptionCollection.updateMany({ petId, _id: { $ne: new ObjectId(id) } }, { $set: { status: "Rejected" } });

                    return res.send({ success: true, message: "Approved successfully" });
                }

                if (status === "Rejected") {
                    await adoptionCollection.updateOne({ _id: new ObjectId(id) }, { $set: { status: "Rejected" } });
                    return res.send({ success: true, message: "Rejected successfully" });
                }

                res.status(400).send({ message: "Invalid action" });
            } catch (error) {
                res.status(500).send({ message: "Update error" });
            }
        });

    } catch (error) {
        console.error("Database connection error:", error);
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Server is up and running!');
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});