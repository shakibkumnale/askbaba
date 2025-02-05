import dotenv from "dotenv";
dotenv.config();

import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { OpenAI } from "openai";
import mongoose from "mongoose";
import pdfParse from "pdf-parse";

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
const upload = multer({ dest: uploadsDir });

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

// Function to parse PDFs safely
async function parsePDF(buffer) {
    try {
        const data = await pdfParse(buffer);
        return data.text;
    } catch (error) {
        console.error("❌ Error parsing PDF:", error);
        throw new Error("Failed to parse PDF file.");
    }
}

app.set("view engine", "ejs");
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

app.get("/upload", (req, res) => {
    res.render("upload", { documentKey: undefined });
});

app.post("/upload", upload.single("pdf"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send("No file uploaded.");
        }

        const filePath = req.file.path;

        if (!fs.existsSync(filePath)) {
            return res.status(404).send("Uploaded file not found.");
        }

        const dataBuffer = fs.readFileSync(filePath);
        const text = await parsePDF(dataBuffer);

        // Split text into smaller chunks
        const chunks = text.split(/\n\s*\n/).filter(chunk => chunk.trim().length > 0);

        // Generate document ID
        const documentId = `doc_${Date.now()}`;

        // Process chunks into MongoDB-compatible vectors
        const vectors = await Promise.all(
            chunks.map(async (chunk, idx) => {
                const embedding = await getEmbeddings(chunk);
                return {
                    id: `${documentId}_${idx}`,
                    values: embedding,
                    metadata: {
                        text: chunk,
                        documentId,
                        fileName: req.file.originalname
                    }
                };
            })
        );

        // Save the document and its vectors to MongoDB
        const newDocument = new Document({
            documentId,
            fileName: req.file.originalname,
            vectors
        });
        await newDocument.save();

        fs.unlinkSync(filePath); // Clean up file after processing

        res.render("upload", { documentKey:documentId });
    } catch (error) {
        console.error("❌ Error in upload process:", error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).send(`Error processing PDF: ${error.message}`);
    }
});

app.get("/", (req, res) => {
    const documentId ="doc_1738755985255";
        // const documentId = req.params.documentId;
    res.render("chat", { documentKey:documentId, fileName: "PDF Document" });
});

// app.post("/chat/:documentId", async (req, res) => {
//     try {
//         const { question } = req.body;
//         const documentId = req.params.documentId;

//         // Get question embedding
//         const questionEmbedding = await getEmbeddings(question);

//         // Query MongoDB for matching vectors based on cosine similarity or any other method you prefer
//         const document = await Document.findOne({ documentId });

//         if (!document) {
//             return res.status(404).json({ error: "Document not found" });
//         }

//         // Find top 3 closest vectors (you may want to implement a more sophisticated similarity search)
//         const matches = document.vectors
//             .map(vector => ({
//                 ...vector,
//                 score: cosineSimilarity(questionEmbedding, vector.values)
//             }))
//             .sort((a, b) => b.score - a.score) // Sort by score (descending)
//             .slice(0, 3); // Take top 3 matches

//         // Format response context
//         const context = matches.map(match => match.metadata.text).join("\n\n");

//         // Generate response using OpenAI
//         const completion = await openai.chat.completions.create({
//             model: "gpt-3.5-turbo",
//             messages: [
//                 { role: "system", content: `You are a helpful assistant. Answer the question based on the following context:\n${context}` },
//                 { role: "user", content: question }
//             ]
//         });

//         res.json({
//             answer: completion.choices[0].message.content,
//             context: matches.map(match => ({
//                 text: match.metadata.text,
//                 score: match.score
//             }))
//         });
//     } catch (error) {
//         console.error("❌ Error in chat process:", error);
//         res.status(500).json({ error: "Error processing question" });
//     }
// });

// Cosine similarity function

// app.post("/chat/:documentId", async (req, res) => {
//     try {
//         const { question } = req.body;
//         const documentId ="doc_1738755985255";
//         // const documentId = req.params.documentId;

//         // Get question embedding
//         const questionEmbedding = await getEmbeddings(question);

//         // Query MongoDB for matching vectors
//         const document = await Document.findOne({ documentId });

//         if (!document) {
//             return res.status(404).json({ error: "Document not found" });
//         }

//         // Find top 3 closest vectors with proper object structure
//         const matches = document.vectors
//             .map(vector => ({
//                 id: vector.id,
//                 values: vector.values,
//                 metadata: vector.metadata,
//                 score: cosineSimilarity(questionEmbedding, vector.values)
//             }))
//             .sort((a, b) => b.score - a.score)
//             .slice(0, 5);

//         // Safely access metadata
//         const context = matches
//             .map(match => match.metadata?.text || "")
//             .filter(text => text.length > 0)
//             .join("\n\n");

//         if (!context) {
//             return res.status(400).json({ error: "No relevant context found in the document" });
//         }
//         console.log("Context:", context);

//         // Generate response using OpenAI
//         const completion = await openai.chat.completions.create({
//             model: "gpt-3.5-turbo",
//             messages: [
//                 { role: "system", content: `You are a helpful assistant. Answer the question based on the following context:\n${context}` },
//                 { role: "user", content: question }
//             ]
//         });

//         res.json({
//             answer: completion.choices[0].message.content,
//             context: matches.map(match => ({
//                 text: match.metadata?.text || "",
//                 score: match.score
//             }))
//         });
//     } catch (error) {
//         console.error("❌ Error in chat process:", error);
//         res.status(500).json({ error: "Error processing question" });
//     }
// });

// Modify the chat endpoint to include more context and longer responses
app.post("/chat/:documentId", async (req, res) => {
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
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
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
            temperature: 0.7,
            max_tokens: 500  // Increased for longer responses
        });

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

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});

// Error handling for unexpected crashes
process.on("uncaughtException", error => console.error("❌ Uncaught Exception:", error));
process.on("unhandledRejection", (reason, promise) => console.error("❌ Unhandled Rejection at:", promise, "reason:", reason));
