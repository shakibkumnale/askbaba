import dotenv from "dotenv";
dotenv.config();
import fetch from 'node-fetch';

import express from "express";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { OpenAI } from "openai";
import mongoose from "mongoose";


console.log("🔄 Initializing MongoDB...");

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("✅ MongoDB connected"))
    .catch(err => {
        console.error("❌ MongoDB connection error:", err);
        process.exit(1);
    });

// MongoDB schema for document metadata
const documentSchema = new mongoose.Schema({
    documentId: String,
    fileName: String,
    vectors: [
        {
            id: String,
            values: [Number],
            metadata: {
                text: String,
                documentId: String,
                fileName: String
            }
        }
    ]
});

const Document = mongoose.model("Document", documentSchema);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();


// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
app.set('views', path.join(__dirname, 'views'));
app.set('public', path.join(__dirname, 'public'));
// Function to get embeddings using OpenAI's text-embedding-3-small
async function getEmbeddings(text) {
    try {
        const response = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: text
        });

        return response.data[0].embedding;
    } catch (error) {
        console.error("❌ Error generating embeddings:", error);
        throw new Error("Embedding generation failed.");
    }
}




app.set("view engine", "ejs");
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));





app.get("/", (req, res) => {
    const documentId ="doc_1738755985255";
        // const documentId = req.params.documentId;
    res.render("chat", { documentKey:documentId, fileName: "PDF Document" });
});

app.post("/chat", async (req, res) => {
    try {
        const { question } = req.body;
        const documentId = "doc_1738755985255";

        // Get question embedding
        const questionEmbedding = await getEmbeddings(question);

        // Query MongoDB for matching vectors - increased to 5 relevant chunks
        const document = await Document.findOne({ documentId });

        if (!document) {
            return res.status(404).json({ error: "Document not found" });
        }

        // Find top 5 closest vectors with proper object structure
        const matches = document.vectors
            .map(vector => ({
                id: vector.id,
                values: vector.values,
                metadata: vector.metadata,
                score: cosineSimilarity(questionEmbedding, vector.values)
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);

        const context = matches
            .map(match => match.metadata?.text || "")
            .filter(text => text.length > 0)
            .join("\n\n");

        if (!context) {
            return res.status(400).json({ error: "No relevant context found in the document" });
        }

        // Enhanced system prompt for longer, more detailed responses
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "HTTP-Referer": "YOUR_SITE_URL", // Replace with your site URL
                "X-Title": "Your App Name",      // Replace with your app name
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "model": "deepseek/deepseek-r1:free",
                "messages": [
                    { 
                        role: "system", 
                        content: `You are a knowledgeable assistant specializing in Dr. B.R. Ambedkar's works. 
                    Provide detailed, thoughtful responses drawing from the context provided. 
                    Include relevant quotes when possible. Structure your responses in 2-3 clear paragraphs.
                    Ensure responses are respectful and accurately represent Dr. Ambedkar's thoughts.
                    Context:\n${context}`
                    },
                    { role: "user", content: question }
                ],
                temperature: 0.2,
                max_tokens: 1500
            })
        });

        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }
        console.log('[Chat POST] API Response Status:', response.status);
        const completion = await response.json();

        // Adjust response handling for OpenRouter's format
        res.json({
            answer: completion.choices[0].message.content,
            context: matches.map(match => ({
                text: match.metadata?.text || "",
                score: match.score,
                citation: `From: ${match.metadata?.fileName || "Document"}`
            }))
        });
    } catch (error) {
        console.error("❌ Error in chat process:", error);
        res.status(500).json({ error: "Error processing question" });
    }
});

function cosineSimilarity(vecA, vecB) {
    const dotProduct = vecA.reduce((sum, val, idx) => sum + val * vecB[idx], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magnitudeA * magnitudeB);
}

// Add after your existing routes, before app.listen()

app.get('/test', async (req, res) => {
    try {
        const serverInfo = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development',
            mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
            serverTime: Date.now()
        };
        
        res.json(serverInfo);
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});

// Error handling for unexpected crashes
process.on("uncaughtException", error => console.error("❌ Uncaught Exception:", error));
process.on("unhandledRejection", (reason, promise) => console.error("❌ Unhandled Rejection at:", promise, "reason:", reason));
