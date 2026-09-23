import express from 'express';
import multer from 'multer';
import { clienteGemini } from '../libs/geminiRotacion.js';
import AIController from '../controllers/ai.controller.js';
import AIImageController from '../controllers/ai.image.controller.js';
import AIEditorController from '../controllers/ai.editor.controller.js';
import { authRequired } from '../middlewares/validateToken.js';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        // Accept audio and image files
        if (file.fieldname === 'audio') {
            // Accept audio files
            if (file.mimetype.startsWith('audio/')) {
                cb(null, true);
            } else {
                cb(new Error('Solo se permiten archivos de audio'), false);
            }
        } else if (file.fieldname === 'image') {
            // Accept image files
            if (file.mimetype.startsWith('image/')) {
                cb(null, true);
            } else {
                cb(new Error('Solo se permiten archivos de imagen'), false);
            }
        } else {
            cb(new Error('Campo de archivo no válido'), false);
        }
    }
});

// Middleware to handle both JSON and multipart form data
const handleMultipleFormats = (req, res, next) => {
    const contentType = req.get('Content-Type') || '';
    
    if (contentType.includes('multipart/form-data')) {
        // Handle file uploads
        upload.fields([
            { name: 'audio', maxCount: 1 },
            { name: 'image', maxCount: 1 }
        ])(req, res, (err) => {
            if (err) {
                console.error('Archivo para IA rechazado:', err);
                return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
                    success: false,
                    error: err.code === 'LIMIT_FILE_SIZE'
                        ? 'El archivo es demasiado grande: el máximo es 10 MB.'
                        : 'No se pudo recibir el archivo. Usa una imagen (JPG o PNG) o un audio e intenta de nuevo.'
                });
            }
            
            // Determine type based on which file was uploaded
            if (req.files && req.files.audio) {
                req.body.type = 'voice';
            } else if (req.files && req.files.image) {
                req.body.type = 'image';
            }
            
            next();
        });
    } else {
        // Handle JSON data
        next();
    }
};

// Routes
// Route: delegate image uploads to AIImageController and keep other types handled
// by AIController. NOTE: We do NOT modify `ai.controller.js` per project requirement.
router.post('/generate-diagram', authRequired, handleMultipleFormats, (req, res, next) => {
    try {
        // If the request was a multipart upload with an image, forward to image controller
        const isImage = (req.files && req.files.image) || req.body.type === 'image';
        if (isImage) {
            return AIImageController.processImageInput(req, res, next);
        }
        // Otherwise, fallback to the existing AIController (text/voice)
        return AIController.generateDiagram(req, res, next);
    } catch (err) {
        next(err);
    }
});

// New dedicated route for image-based diagram generation.
// This ensures frontend image uploads can call a specific endpoint that
// is handled entirely by AIImageController and does not touch ai.controller.js.
router.post('/generate-diagram/image', authRequired, handleMultipleFormats, (req, res, next) => {
    try {
        return AIImageController.processImageInput(req, res, next);
    } catch (err) {
        next(err);
    }
});
// Verification endpoint: accepts systemPrompt + userPrompt (or nodes/edges) and
// runs the AI verification flow server-side to avoid exposing API keys.
router.post('/verify-diagram', authRequired, async (req, res, next) => {
    try {
        return await AIController.verifyDiagram(req, res, next);
    } catch (err) {
        next(err);
    }
});
router.get('/features', AIController.getAIFeatures);

// Diagram editing: accepts current nodes/edges + prompt and returns a modified state
router.post('/modify-diagram', authRequired, handleMultipleFormats, AIEditorController.modifyDiagram);

// Get editor features and capabilities
router.get('/editor/features', AIEditorController.getEditorFeatures);

// Health check for AI service
router.get('/health', (req, res) => {
    res.json({
        success: true,
        message: 'AI Service is running',
        // Cuántas API keys de Gemini hay en rotación y cuántas tienen cuota (sin exponerlas)
        gemini: clienteGemini.estado(),
        timestamp: new Date().toISOString()
    });
});

export default router;