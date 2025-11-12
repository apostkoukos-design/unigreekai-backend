// ==========================================================
// ✅ UniGreekAI Backend — Production Grade Server
// ==========================================================

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import * as pdfParse from "pdf-parse";
import mammoth from "mammoth";
import Tesseract from "tesseract.js";
import OpenAI from "openai";
import dotenv from "dotenv";
import xlsx from "xlsx";
import Database from "better-sqlite3";
import multer from "multer";
import crypto from "crypto";
import rateLimit from "express-rate-limit";

dotenv.config();
const app = express();
app.use(express.json());
app.use(helmet());
app.use(morgan("dev"));

// ==========================================================
// ✅ CORS (ελεύθερο για όλα τα origin - dev mode)
// ==========================================================
app.use(cors());

// ==========================================================
// ✅ Rate Limiter
// ==========================================================
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 λεπτά
  max: 100,
  message: { error: "Πάρα πολλά αιτήματα. Προσπάθησε ξανά σε λίγο." },
});
app.use(limiter);

// ==========================================================
// ✅ Multer — File uploads με ασφάλεια
// ==========================================================
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "image/jpeg",
      "image/png",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error("❌ Μη υποστηριζόμενος τύπος αρχείου."), false);
    }
    cb(null, true);
  },
});

// ==========================================================
// ✅ SQLite Cache για AI απαντήσεις
// ==========================================================
const db = new Database("cache.db");
db.prepare(`
  CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    value TEXT,
    timestamp INTEGER
  )
`).run();

function getCache(key, ttlMs) {
  const row = db.prepare("SELECT value, timestamp FROM cache WHERE key = ?").get(key);
  if (row && Date.now() - row.timestamp < ttlMs) return JSON.parse(row.value);
  return null;
}
function setCache(key, value) {
  db.prepare("INSERT OR REPLACE INTO cache (key, value, timestamp) VALUES (?, ?, ?)").run(
    key,
    JSON.stringify(value),
    Date.now()
  );
}

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const memory = {};

setInterval(() => {
  db.prepare("DELETE FROM cache WHERE ? - timestamp > ?").run(Date.now(), CACHE_TTL);
}, 12 * 60 * 60 * 1000);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ==========================================================
// ✅ Helper για ασφαλή OpenAI calls με retry
// ==========================================================
async function safeCompletion(params, retries = 2) {
  try {
    return await openai.chat.completions.create(params);
  } catch (err) {
    if (retries > 0) {
      console.warn("⚠️ Retry OpenAI call...");
      await new Promise((r) => setTimeout(r, 1500));
      return safeCompletion(params, retries - 1);
    }
    throw err;
  }
}

// ==========================================================
// ✅ Εξαγωγή κειμένου από διάφορους τύπους αρχείων
// ==========================================================
async function extractTextFromFile(filePath, mime) {
  try {
    if (mime.includes("pdf")) {
      const data = fs.readFileSync(filePath);
      const pdfData = await pdfParse(data);
      return pdfData.text;
    } else if (mime.includes("word") || mime.includes("docx")) {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    } else if (mime.includes("image")) {
      const result = await Tesseract.recognize(filePath, "ell+eng");
      return result.data.text;
    } else if (mime.includes("excel")) {
      const workbook = xlsx.readFile(filePath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      return JSON.stringify(xlsx.utils.sheet_to_json(sheet), null, 2);
    } else if (mime.includes("text")) {
      return fs.readFileSync(filePath, "utf-8");
    } else {
      throw new Error("Unsupported file type");
    }
  } catch (err) {
    console.error("❌ extractTextFromFile error:", err);
    return "";
  }
}

// ==========================================================
// 🎓 Εξειδίκευση ανά Τμήμα
// ==========================================================
const toneByDept = {
  "Ηλεκτρολόγων Μηχανικών και Μηχανικών Υπολογιστών":
    "Χρησιμοποίησε τεχνικούς όρους, αναφέρσου σε έννοιες όπως σήματα, μηχανική μάθηση, ηλεκτρονικά και προγραμματισμό.",
  "Πληροφορικής":
    "Εστίασε σε αλγορίθμους, δεδομένα, τεχνητή νοημοσύνη, προγραμματισμό και λογική επίλυσης προβλημάτων.",
  "Οικονομικών Επιστημών":
    "Χρησιμοποίησε οικονομικούς όρους, θεωρίες αγοράς, μικροοικονομία και μακροοικονομία, παραδείγματα αγοράς.",
  "Φιλολογίας":
    "Δώσε έμφαση στη γλωσσική ανάλυση, στη σύνταξη, στη σημασία των λέξεων και στη λογοτεχνική προσέγγιση.",
  "Νομικής":
    "Απάντα με νομική ακρίβεια, κάνοντας αναφορές σε άρθρα, παραγράφους και νομικές έννοιες όπου είναι δυνατόν.",
  "Ιατρικής":
    "Απάντα με επιστημονική ορολογία, εξήγησε παθοφυσιολογικές έννοιες, και χρησιμοποίησε παραδείγματα από την πράξη.",
  "Ψυχολογίας":
    "Απάντα με όρους ψυχολογίας, θεωρίες συμπεριφοράς, γνωσιακή ανάλυση και κοινωνιολογική οπτική.",
  "Παιδαγωγικού":
    "Χρησιμοποίησε παραδείγματα από σχολικές τάξεις, θεωρίες μάθησης και παιδαγωγικές προσεγγίσεις.",
  "Μαθηματικών":
    "Απάντα με μαθηματική ακρίβεια, χρησιμοποίησε εξισώσεις, ορισμούς και αποδείξεις όπου είναι δυνατόν.",
};

// ==========================================================
// ✅ Έξυπνο και σταθερό CHAT Endpoint
// ==========================================================
app.post(
  "/chat",
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  async (req, res) => {
    const { message, university, department, userId } = req.body;
    const filePath = req.file?.path;
    const mime = req.file?.mimetype;
    const memoryId = userId || "default_user";

    if (!message && !filePath)
      return res.status(400).json({ error: "Μήνυμα ή αρχείο απαιτείται." });

    let extractedText = "";
    if (filePath) {
      extractedText = await extractTextFromFile(filePath, mime);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    const fileHash = filePath
      ? crypto.createHash("md5").update(extractedText || "").digest("hex").slice(0, 8)
      : "";

    const cacheKey = `${university}_${department}_${message.trim().toLowerCase()}_${fileHash}`;
    const cached = getCache(cacheKey, CACHE_TTL);
    if (cached) return res.json({ reply: cached.answer });

    if (!memory[memoryId]) memory[memoryId] = [];

    if (extractedText.length > 8000) {
      extractedText =
        extractedText.slice(0, 8000) +
        "\n[...Το υπόλοιπο κείμενο παραλείφθηκε για ανάλυση...]";
    }

    let fileSummary = "";
    if (extractedText && extractedText.length > 1500) {
      try {
        const summaryCompletion = await safeCompletion({
          model: "gpt-4o-mini",
          temperature: 0.5,
          messages: [
            { role: "system", content: "Περίληψε σύντομα το παρακάτω κείμενο στα ελληνικά με ουδέτερο τόνο." },
            { role: "user", content: extractedText.slice(0, 6000) },
          ],
        });
        fileSummary = summaryCompletion.choices[0].message.content.trim();
      } catch (err) {
        console.warn("⚠️ Αποτυχία περίληψης αρχείου:", err.message);
      }
    }

    const extraTone = toneByDept[department?.trim()] || "";
    const systemPrompt = `
Είσαι ο UniGreekAI — ένας πανεπιστημιακός βοηθός που μιλάει πάντα στα ελληνικά με φυσικό, έξυπνο και φιλικό ύφος.

Πλαίσιο:
- Πανεπιστήμιο: ${university || "Άγνωστο"}
- Τμήμα: ${department || "Άγνωστο"}

Οδηγίες:
- Απάντα με σαφήνεια, επαγγελματικά αλλά όχι ψυχρά.
- Προσαρμόζεις τις απαντήσεις στο αντικείμενο σπουδών.
- Εξήγησε έννοιες με μικρά παραδείγματα.
${extraTone ? `- Ειδικές οδηγίες για το Τμήμα: ${extraTone}` : ""}
- Αν υπάρχει αρχείο, περιέγραψε πρώτα τι περιέχει και μετά ανέλυσέ το.
- Ζήτα διευκρίνιση όταν η ερώτηση δεν είναι σαφής.
`;

    memory[memoryId].push({ role: "user", content: message });
    if (fileSummary) {
      memory[memoryId].push({ role: "system", content: `Περίληψη αρχείου: ${fileSummary}` });
    } else if (extractedText) {
      memory[memoryId].push({ role: "system", content: `Το αρχείο περιέχει:\n${extractedText}` });
    }

    const messagesForGPT = [{ role: "system", content: systemPrompt }, ...memory[memoryId]];

    try {
      const completion = await safeCompletion({
        model: "gpt-4o-mini",
        temperature: 0.8,
        messages: messagesForGPT,
      });

      const aiReply = completion.choices[0].message.content.trim();
      setCache(cacheKey, { answer: aiReply });
      memory[memoryId].push({ role: "assistant", content: aiReply });
      res.json({ reply: aiReply });
    } catch (err) {
      console.error("❌ Chat error:", err);
      res.status(500).json({ error: "AI processing error" });
    }
  }
);

// ==========================================================
// ✅ /create-assignment — Παραγωγή Word Εργασίας
// ==========================================================
app.post(
  "/create-assignment",
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  async (req, res) => {
    const { university, department, title } = req.body;
    const filePath = req.file?.path;
    const mime = req.file?.mimetype;

    if (!filePath) return res.status(400).json({ error: "Δεν επιλέχθηκε αρχείο." });

    try {
      const text = await extractTextFromFile(filePath, mime);
      const completion = await safeCompletion({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: `
Δημιούργησε μια πανεπιστημιακή εργασία στα ελληνικά βασισμένη στο παρακάτω κείμενο.
Να περιλαμβάνει αριθμημένες ερωτήσεις και απαντήσεις (1., 2., 3.…)
με επαγγελματικό, ακαδημαϊκό ύφος — χωρίς markdown ή διαχωριστικά.

Κείμενο:
${text}`,
          },
        ],
      });

      let aiReply = completion.choices[0].message.content.trim();
      aiReply = aiReply.replace(/[-*_`#>~]+/g, "").replace(/\n{3,}/g, "\n\n").trim();
      const cleanReply = aiReply.replace(/^#+\s?/gm, "").trim();

      const { Document, Packer, Paragraph, TextRun, AlignmentType } = await import("docx");

      const doc = new Document({
        sections: [
          {
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 200 },
                children: [new TextRun({ text: university.toUpperCase(), bold: true, size: 32 })],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 400 },
                children: [new TextRun({ text: `ΤΜΗΜΑ ${department.toUpperCase()}`, italics: true, size: 28 })],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 300 },
                children: [
                  new TextRun({ text: title || "Εργασία Φοιτητή", bold: true, size: 30, underline: {} }),
                ],
              }),
              new Paragraph({ text: "" }),
              new Paragraph({ children: [new TextRun({ text: "Φοιτητής: ...........................................", size: 26 })] }),
              new Paragraph({ children: [new TextRun({ text: "Αριθμός Μητρώου: ................................", size: 26 })] }),
              new Paragraph({ children: [new TextRun({ text: "Ημερομηνία: ........................................", size: 26 })] }),
              new Paragraph({ text: "" }),
              ...cleanReply.split("\n").map(
                (line) =>
                  new Paragraph({
                    spacing: { line: 300 },
                    children: [new TextRun({ text: line.trim(), size: 26, font: "Calibri" })],
                  })
              ),
            ],
          },
        ],
      });

      const buffer = await Packer.toBuffer(doc);
      const outputPath = path.join("uploads", "εργασία.docx");
      fs.writeFileSync(outputPath, buffer);
      res.download(outputPath, "εργασία.docx", () => fs.unlinkSync(outputPath));
    } catch (err) {
      console.error("❌ Word creation error:", err);
      res.status(500).json({ error: "Αποτυχία δημιουργίας Word." });
    } finally {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  }
);

// ==========================================================
// ✅ Global Error Handler
// ==========================================================
app.use((err, req, res, next) => {
  console.error("❌ Server error:", err);
  res.status(500).json({ error: err.message || "Σφάλμα διακομιστή." });
});

// ==========================================================
// ✅ Εκκίνηση Διακομιστή
// ==========================================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ UniGreekAI Server running at http://localhost:${PORT}`));
