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
  ExportPDFJob,
  ExportPDFParams,
  ExportPDFResult,
  ExportPDFTargetFormat,
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

// Διαγραφή προσωρινών αρχείων (αγνοεί σφάλματα)
function cleanupFiles(...paths) {
  for (const p of paths) {
    try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (_) { /* ήδη διαγράφηκε */ }
  }
}

// Φιλικό μήνυμα για σφάλματα Adobe (null = μη-Adobe σφάλμα)
function adobeErrorMessage(err) {
  if (err instanceof SDKError || err instanceof ServiceUsageError) return 'Σφάλμα Adobe API: ' + err.message;
  if (err instanceof ServiceApiError) return 'Σφάλμα υπηρεσίας Adobe: ' + err.message;
  return null;
}

// Κοινό pipeline: upload PDF → εκτέλεση job → εγγραφή αποτελέσματος σε προσωρινό αρχείο.
// jobBuilder({ inputAsset }) επιστρέφει { job, resultType }. Επιστρέφει το outputPath.
async function processPdf(inputPath, { prefix, ext }, jobBuilder) {
  const credentials = new ServicePrincipalCredentials({
    clientId: process.env.PDF_SERVICES_CLIENT_ID,
    clientSecret: process.env.PDF_SERVICES_CLIENT_SECRET
  });
  const pdfServices = new PDFServices({ credentials });

  const readStream = fs.createReadStream(inputPath);
  const inputAsset = await pdfServices.upload({ readStream, mimeType: MimeType.PDF });

  const { job, resultType } = jobBuilder({ inputAsset });
  const pollingURL = await pdfServices.submit({ job });
  const pdfServicesResponse = await pdfServices.getJobResult({ pollingURL, resultType });

  const resultAsset = pdfServicesResponse.result.asset;
  const streamAsset = await pdfServices.getContent({ asset: resultAsset });

  const outputPath = path.join('uploads', `${prefix}-${Date.now()}.${ext}`);
  const outputStream = fs.createWriteStream(outputPath);
  await new Promise((resolve, reject) => {
    streamAsset.readStream.pipe(outputStream);
    outputStream.on('finish', resolve);
    outputStream.on('error', reject);
  });
  return outputPath;
}

app.post('/api/compress', compressLimiter, upload.single('pdf'), async (req, res) => {
  let inputPath = null;
  let outputPath = null;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Δεν βρέθηκε PDF αρχείο' });
    }
    inputPath = req.file.path;
    const compressionLevel = req.body.compressionLevel || 'MEDIUM';
    if (!['LOW', 'MEDIUM', 'HIGH'].includes(compressionLevel)) {
      throw new Error('Μη έγκυρο επίπεδο συμπίεσης');
    }

    const originalName = req.file.originalname || req.file.filename;
    console.log(`Συμπίεση PDF: ${JSON.stringify(originalName)} με επίπεδο: ${compressionLevel}`);

    const params = new CompressPDFParams({ compressionLevel: CompressionLevel[compressionLevel] });
    outputPath = await processPdf(inputPath, { prefix: 'compressed', ext: 'pdf' },
      ({ inputAsset }) => ({ job: new CompressPDFJob({ inputAsset, params }), resultType: CompressPDFResult }));

    const originalSize = fs.statSync(inputPath).size;
    const compressedSize = fs.statSync(outputPath).size;
    const reductionPercent = originalSize > 0 ? (((originalSize - compressedSize) / originalSize) * 100).toFixed(1) : '0.0';
    console.log(`Συμπίεση ολοκληρώθηκε: ${originalSize} → ${compressedSize} bytes (${reductionPercent}%)`);

    res.download(outputPath, 'compressed.pdf', (err) => {
      cleanupFiles(inputPath, outputPath);
      if (err) console.error('Σφάλμα κατά την αποστολή αρχείου:', err);
    });
  } catch (err) {
    console.error('Σφάλμα συμπίεσης:', err);
    cleanupFiles(inputPath, outputPath);
    res.status(500).json({ error: adobeErrorMessage(err) || 'Σφάλμα κατά τη συμπίεση του PDF' });
  }
});

// Endpoint για μετατροπή PDF σε Excel (.xlsx)
app.post('/api/convert', compressLimiter, upload.single('pdf'), async (req, res) => {
  let inputPath = null;
  let outputPath = null;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Δεν βρέθηκε PDF αρχείο' });
    }
    inputPath = req.file.path;

    const originalName = req.file.originalname || req.file.filename;
    console.log(`Μετατροπή PDF σε Excel: ${JSON.stringify(originalName)}`);

    const params = new ExportPDFParams({ targetFormat: ExportPDFTargetFormat.XLSX });
    outputPath = await processPdf(inputPath, { prefix: 'converted', ext: 'xlsx' },
      ({ inputAsset }) => ({ job: new ExportPDFJob({ inputAsset, params }), resultType: ExportPDFResult }));

    let convertedSize = '?';
    try { convertedSize = fs.statSync(outputPath).size; } catch (_) {}
    console.log(`Μετατροπή ολοκληρώθηκε: ${convertedSize} bytes`);

    const downloadName = path.parse(originalName).name + '.xlsx';
    res.download(outputPath, downloadName, (err) => {
      cleanupFiles(inputPath, outputPath);
      if (err) console.error('Σφάλμα κατά την αποστολή αρχείου:', err);
    });
  } catch (err) {
    console.error('Σφάλμα μετατροπής:', err);
    cleanupFiles(inputPath, outputPath);
    res.status(500).json({ error: adobeErrorMessage(err) || 'Σφάλμα κατά τη μετατροπή σε Excel' });
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
