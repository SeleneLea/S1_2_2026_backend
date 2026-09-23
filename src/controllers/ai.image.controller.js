import { clienteGemini } from '../libs/geminiRotacion.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mensajeErrorIA } from '../libs/mensajesError.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cliente de Gemini que rota las API keys configuradas (GEMINI_API_KEYS / GEMINI_API_KEY)
const genAI = clienteGemini;

class AIImageController {
    // Analyze image using Gemini Vision
    static async analyzeImage(imageFile) {
        let tempPath; // Define tempPath here to be accessible in the finally block
        try {
            // Save the image file temporarily
            tempPath = path.join(__dirname, '../../temp/', `image_${Date.now()}.jpg`);
            
            // Create temp directory if it doesn't exist
            const tempDir = path.dirname(tempPath);
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            fs.writeFileSync(tempPath, imageFile.buffer);

            // Gemini Vision implementation (model configurable via GEMINI_MODEL env var)
            const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
            const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

            // Read image as base64
            const imageBuffer = fs.readFileSync(tempPath);
            const base64Image = imageBuffer.toString('base64');

            const prompt = `Analiza esta imagen y describe cualquier diagrama de clases, esquemas, o estructuras de datos que veas. 
            Si ves un diagrama UML, describe las clases, atributos, métodos y relaciones.
            Si ves texto relacionado con programación o bases de datos, descríbelo detalladamente.
            Si no hay nada relacionado con diagramas o programación, di qué ves en la imagen de manera general.`;

            const result = await model.generateContent([
                prompt,
                {
                    inlineData: {
                        data: base64Image,
                        mimeType: imageFile.mimetype || 'image/jpeg'
                    }
                }
            ]);

            const response = await result.response;
            const text = await response.text();
            return text;

        } catch (error) {
            console.error('Error analizando imagen:', error);
            throw new Error(`Error analizando imagen: ${error.message}`);
        } finally {
            // Clean up temp file
            if (tempPath && fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
        }
    }

    // Try to extract relationships between a set of class names using the model.
    // Returns an array of relationship objects: { sourceName, targetName, type, cardinality }
    static async extractRelationshipsForClasses(originalText, elements = []) {
        try {
            const classNames = (Array.isArray(elements) ? elements.map(e => e.name || e.title || '').filter(Boolean) : []).slice(0, 50);
            const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
            const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

            const prompt = `Tienes la siguiente descripción o interpretación de una imagen:\n\n${originalText}\n\nY las clases detectadas: ${JSON.stringify(classNames)}\n\nDEVUELVE SÓLO un JSON válido con forma: { "relationships": [ { "sourceName": "<nombre>", "targetName": "<nombre>", "type": "Association|Inheritance|Composition|Aggregation", "cardinality": "1..n|1..1|0..n" } ] }.\nSi no puedes determinar relaciones confiables, devuelve {"relationships": []}. No incluyas texto adicional ni explicaciones.`;

            const result = await model.generateContent(prompt);
            const resp = await result.response;
            const text = await resp.text();

            // Try parse JSON
            let parsed = null;
            try {
                parsed = JSON.parse(text);
            } catch (e) {
                const m = text.match(/\{[\s\S]*\}/);
                if (m) {
                    try { parsed = JSON.parse(m[0]); } catch (e2) { /* fallthrough */ }
                }
            }

            if (!parsed) return [];

            if (Array.isArray(parsed)) return parsed; // array of relationships
            if (parsed.relationships && Array.isArray(parsed.relationships)) return parsed.relationships;

            // tolerate slight variations
            if (parsed.rels && Array.isArray(parsed.rels)) return parsed.rels;

            return [];
        } catch (error) {
            console.warn('extractRelationshipsForClasses error:', error && error.message ? error.message : error);
            return [];
        }
    }

    // Process image input and generate diagram
    static async processImageInput(req, res) {
        try {
            const { salaId } = req.body;

            // Handle image file from FormData
            if (!req.files || !req.files.image) {
                throw new Error('No se encontró archivo de imagen');
            }

            // Analyze image
            const analyzedText = await AIImageController.analyzeImage(req.files.image[0]);
            
            // Import the main AI controller to use its diagram generation
            const AIController = (await import('./ai.controller.js')).default;
            
            // Generate diagram using analyzed text
            const diagram = await AIController.generateUMLFromText(analyzedText);

            // Validate and normalize diagram structure
            AIController.validateDiagramStructure(diagram);

            // If the model produced classes but no relationships, attempt a focused
            // extraction step to recover relationships from the original text
            // (or from the list of detected class names). This is a localized
            // post-processing step that improves recall for edge detection
            // without modifying `ai.controller.js`.
            try {
                const hasElements = Array.isArray(diagram.elements) && diagram.elements.length > 0;
                const hasRelationships = Array.isArray(diagram.relationships) && diagram.relationships.length > 0;
                if (hasElements && !hasRelationships) {
                    const extracted = await AIImageController.extractRelationshipsForClasses(analyzedText, diagram.elements);
                    if (extracted && Array.isArray(extracted) && extracted.length > 0) {
                        // Ensure relationships array exists
                        if (!Array.isArray(diagram.relationships)) diagram.relationships = [];
                        // Map extracted relationships (by name) to element ids
                        const nameToElement = new Map();
                        const normalize = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
                        diagram.elements.forEach(el => {
                            const n = normalize(el.name || el.title || el.id || '');
                            if (n) nameToElement.set(n, el);
                        });

                        let added = 0;
                        for (let i = 0; i < extracted.length; i++) {
                            const r = extracted[i];
                            if (!r || (!r.sourceName && !r.source) || (!r.targetName && !r.target)) continue;
                            const sourceNameRaw = r.sourceName || r.source;
                            const targetNameRaw = r.targetName || r.target;
                            const sNorm = normalize(sourceNameRaw);
                            const tNorm = normalize(targetNameRaw);

                            const tryFind = (norm) => {
                                if (nameToElement.has(norm)) return nameToElement.get(norm);
                                // Try partial contains
                                for (const [k, v] of nameToElement.entries()) {
                                    if (k.includes(norm) || norm.includes(k)) return v;
                                }
                                return null;
                            };

                            const sourceEl = tryFind(sNorm);
                            const targetEl = tryFind(tNorm);
                            if (!sourceEl || !targetEl) continue; // skip unmapped

                            const rel = {
                                id: `img_rel_${Date.now()}_${i}`,
                                type: r.type || r.relation || 'Association',
                                sourceId: sourceEl.id,
                                targetId: targetEl.id,
                                cardinality: r.cardinality || r.card || null
                            };
                            diagram.relationships.push(rel);
                            added++;
                        }

                        if (added > 0) {
                            // Re-run lightweight validation on relationships
                            AIController.validateDiagramStructure(diagram);
                        }
                    }
                }
            } catch (ppErr) {
                console.warn('Post-process relationships failed:', ppErr && ppErr.message ? ppErr.message : ppErr);
                // proceed returning original diagram
            }

            const responseMessage = `Diagrama generado desde imagen`;

            res.json({
                success: true,
                message: responseMessage,
                diagram: diagram,
                originalInput: analyzedText
            });

        } catch (error) {
            console.error('Error en Image Controller:', error);
            res.status(500).json({
                success: false,
                error: mensajeErrorIA(error, 'No se pudo generar el diagrama a partir de la imagen. Prueba con una foto más nítida o intenta de nuevo.')
            });
        }
    }
}

export default AIImageController;