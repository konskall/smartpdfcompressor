require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const {
  ServicePrincipalCredentials,
  PDFServices,
  MimeType,
  CompressPDFJob,
  CompressPDFParams,
  CompressionLevel,
  CompressPDFResult,
  SDKError,
  ServiceUsageError,
  ServiceApiError
} = require('@adobe/pdfservices-node-sdk');

// Έλεγχος credentials πριν την εκκίνηση
if (!process.env.PDF_SERVICES_CLIENT_ID || !process.env.PDF_SERVICES_CLIENT_SECRET) {
  console.error('ΣΦΑΛΜΑ: Λείπουν τα Adobe credentials (PDF_SERVICES_CLIENT_ID, PDF_SERVICES_CLIENT_SECRET)');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// Rate limiter: max 20 αιτήσεις ανά 15 λεπτά ανά IP
const compressLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Πολλές αιτήσεις. Δοκιμάστε ξανά σε 15 λεπτά.' }
});

// Middleware
app.use(cors({
  origin: ['https://konskall.github.io', 'http://localhost:3000']
}));
app.use(express.static('public'));
app.use(express.json());

// Configure multer για upload
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max (ίδιο με frontend)
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Μόνο PDF αρχεία επιτρέπονται'));
    }
  }
});

// Endpoint για συμπίεση PDF
app.post('/api/compress', compressLimiter, upload.single('pdf'), async (req, res) => {
  let inputPath = null;
  let outputPath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Δεν βρέθηκε PDF αρχείο' });
    }

    inputPath = req.file.path;
    const compressionLevel = req.body.compressionLevel || 'MEDIUM';

    // Validate compression level
    const validLevels = ['LOW', 'MEDIUM', 'HIGH'];
    if (!validLevels.includes(compressionLevel)) {
      throw new Error('Μη έγκυρο επίπεδο συμπίεσης');
    }

    const originalName = req.file.originalname || req.file.filename;
    console.log(`Συμπίεση PDF: ${JSON.stringify(originalName)} με επίπεδο: ${compressionLevel}`);

    // Setup Adobe credentials
    const credentials = new ServicePrincipalCredentials({
      clientId: process.env.PDF_SERVICES_CLIENT_ID,
      clientSecret: process.env.PDF_SERVICES_CLIENT_SECRET
    });

    // Create PDF Services instance
    const pdfServices = new PDFServices({ credentials });

    // Upload input file
    const readStream = fs.createReadStream(inputPath);
    const inputAsset = await pdfServices.upload({
      readStream,
      mimeType: MimeType.PDF
    });

    // Set compression parameters
    const params = new CompressPDFParams({
      compressionLevel: CompressionLevel[compressionLevel]
    });

    // Create and submit job
    const job = new CompressPDFJob({ inputAsset, params });
    const pollingURL = await pdfServices.submit({ job });
    const pdfServicesResponse = await pdfServices.getJobResult({
      pollingURL,
      resultType: CompressPDFResult
    });

    // Get compressed PDF
    const resultAsset = pdfServicesResponse.result.asset;
    const streamAsset = await pdfServices.getContent({ asset: resultAsset });

    // Save to temp file
    outputPath = path.join('uploads', `compressed-${Date.now()}.pdf`);
    const outputStream = fs.createWriteStream(outputPath);

    await new Promise((resolve, reject) => {
      streamAsset.readStream.pipe(outputStream);
      outputStream.on('finish', resolve);
      outputStream.on('error', reject);
    });

    // Get file sizes
    const originalSize = fs.statSync(inputPath).size;
    const compressedSize = fs.statSync(outputPath).size;
    const reduction = originalSize - compressedSize;
    const reductionPercent = originalSize > 0 
      ? ((reduction / originalSize) * 100).toFixed(1) 
      : '0.0';

    console.log(`Συμπίεση ολοκληρώθηκε: ${originalSize} → ${compressedSize} bytes (${reductionPercent}%)`);

    // Send compressed file
    res.download(outputPath, 'compressed.pdf', (err) => {
      try { if (inputPath) fs.unlinkSync(inputPath); } catch (_) {}
      try { if (outputPath) fs.unlinkSync(outputPath); } catch (_) {}
      if (err) console.error('Σφάλμα κατά την αποστολή αρχείου:', err);
    });

  } catch (err) {
    console.error('Σφάλμα συμπίεσης:', err);

    // Cleanup on error
    if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

    let errorMessage = 'Σφάλμα κατά τη συμπίεση του PDF';
    
    if (err instanceof SDKError || err instanceof ServiceUsageError) {
      errorMessage = 'Σφάλμα Adobe API: ' + err.message;
    } else if (err instanceof ServiceApiError) {
      errorMessage = 'Σφάλμα υπηρεσίας Adobe: ' + err.message;
    }

    res.status(500).json({ error: errorMessage });
  }
});

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Create uploads directory if not exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Περιοδικό cleanup αρχείων > 30 λεπτών (για crashes που αφήνουν temp files)
setInterval(() => {
  const now = Date.now();
  fs.readdirSync('uploads').forEach(file => {
    const filePath = path.join('uploads', file);
    try {
      if (now - fs.statSync(filePath).mtimeMs > 30 * 60 * 1000) {
        fs.unlinkSync(filePath);
        console.log(`Cleanup: διαγράφηκε ${file}`);
      }
    } catch (_) { /* αρχείο ήδη διαγράφηκε */ }
  });
}, 10 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📄 Adobe PDF Services API ready`);
});
