import { archivoServicio } from './FlutterNombres.js';
import { rutaEntidad } from './NombresReservados.js';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import DiagramParser from './DiagramParser.js';
import FlutterModelGenerator from './FlutterModelGenerator.js';
import FlutterServiceGenerator from './FlutterServiceGenerator.js';
import FlutterScreenGenerator from './FlutterScreenGenerator.js';
import FlutterMainGenerator from './FlutterMainGenerator.js';
import { archivoDart, atributosDTO, esAbstracta, esAuxiliar } from './FlutterNombres.js';
import {
  asistenteLocalDart, asistentePantallaDart, asistenteServicioDart
} from './FlutterAsistenteGenerator.js';
import { authServicioDart, loginPantallaDart } from './FlutterAuthGenerator.js';
import { aplicarPermisos, permisosDe } from './Permisos.js';
import { permisosDart } from './FlutterPermisosGenerator.js';

class FlutterProjectBuilder {
  /**
   * @param {string} projectName  nombre de la carpeta temporal (lleva timestamp)
   * @param {string} xmlString    diagrama convertido
   * @param {string} basePath     carpeta temporal de exportaciones
   * @param {{ nombreApp?: string }} opciones  nombre visible y del paquete Dart
   */
  constructor(projectName, xmlString, basePath, { nombreApp, proposito } = {}) {
    this.projectName = this.sanitizeProjectName(projectName);
    this.nombreApp = nombreApp || projectName;
    // De qué trata el sistema: el asistente del teléfono lo usa para presentarse
    this.proposito = proposito || '';
    this.nombrePaquete = this.sanitizeProjectName(nombreApp || projectName);
    this.xmlString = xmlString;
    this.basePath = basePath;
    this.projectPath = path.join(basePath, `${this.projectName}_flutter`);
    this.entities = [];
    this.relationships = [];
  }

  sanitizeProjectName(name) {
    return String(name).toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/^[0-9]/, 'app_$&');
  }

  async build() {
    try {
      this.archivosEscritos = new Set();
      const parser = new DiagramParser();
      const parsedDiagram = parser.parse(this.xmlString);
      this.relationships = parsedDiagram.relationships || [];
      // Mismo criterio que el backend: interfaces y enumeraciones no son entidades,
      // y las clases abstractas no tienen API propia (sus campos van en las hijas).
      this.entities = parsedDiagram.entities.filter(e => !esAuxiliar(e));
      this.entidadesConApi = this.entities.filter(e => !esAbstracta(e));
      this.politica = permisosDe(this.entities, this.relationships, parsedDiagram.permisosCrudos);
      aplicarPermisos(this.entities, this.relationships, this.politica);

      await this.createProjectStructure();
      await this.escribirNuevo(path.join(this.projectPath, 'lib', 'config', 'permisos.dart'), permisosDart(this.politica));
      await this.generateModels();
      await this.generateServices();
      await this.generateAutenticacion();
      await this.generateScreens();
      await this.generateAsistente();
      await this.generateMainFiles();
    } catch (error) {
      console.error('❌ Error construyendo proyecto Flutter:', error);
      throw error;
    }
  }

  async escribirNuevo(ruta, contenido) {
    const clave = path.resolve(ruta).toLowerCase();
    if (this.archivosEscritos.has(clave)) throw new Error(`Dos generadores intentaron escribir ${path.basename(ruta)}.`);
    try {
      await fs.writeFile(ruta, contenido, { encoding: 'utf8', flag: 'wx' });
      this.archivosEscritos.add(clave);
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`Dos generadores intentaron escribir ${path.basename(ruta)}.`);
      throw error;
    }
  }

  async createProjectStructure() {
    const directories = [
      this.projectPath,
      path.join(this.projectPath, 'lib'),
      path.join(this.projectPath, 'lib', 'models'),
      path.join(this.projectPath, 'lib', 'services'),
      path.join(this.projectPath, 'lib', 'screens'),
      path.join(this.projectPath, 'lib', 'config'),
      path.join(this.projectPath, 'lib', 'asistente'),
      path.join(this.projectPath, 'test'),
    ];
    for (const dir of directories) {
      if (!existsSync(dir)) {
        await fs.mkdir(dir, { recursive: true });
      }
    }
  }

  async generateModels() {
    const generator = new FlutterModelGenerator(this.entities, this.relationships);
    for (const entity of this.entities) {
      const filePath = path.join(this.projectPath, 'lib', 'models', `${archivoDart(entity.name)}.dart`);
      await this.escribirNuevo(filePath, generator.generate(entity), 'utf8');
    }
  }

  async generateServices() {
    const generator = new FlutterServiceGenerator(this.entities, this.relationships, this.entidadesConApi);
    await this.escribirNuevo(
      path.join(this.projectPath, 'lib', 'services', 'base_service.dart'),
      generator.generateBaseService(),
      'utf8'
    );
    for (const entity of this.entidadesConApi) {
      const filePath = path.join(this.projectPath, 'lib', 'services', `${archivoServicio(entity.name)}.dart`);
      await this.escribirNuevo(filePath, generator.generate(entity), 'utf8');
    }
  }

  /**
   * Asistente de la app: el del teléfono (sin internet) y el que consulta al backend.
   */
  async generateAsistente() {
    const atributosDe = (entity) => atributosDTO(entity, this.entities, this.relationships);
    await this.escribirNuevo(
      path.join(this.projectPath, 'lib', 'asistente', 'asistente_local.dart'),
      asistenteLocalDart(this.nombreApp, this.entidadesConApi, atributosDe, this.proposito),
      'utf8'
    );
    await this.escribirNuevo(
      path.join(this.projectPath, 'lib', 'services', 'asistente_service.dart'),
      asistenteServicioDart(),
      'utf8'
    );
    await this.escribirNuevo(
      path.join(this.projectPath, 'lib', 'screens', 'asistente_screen.dart'),
      asistentePantallaDart(this.nombreApp, this.entidadesConApi),
      'utf8'
    );
  }

  /** Inicio de sesión: servicio con el token y pantalla de acceso. */
  async generateAutenticacion() {
    await this.escribirNuevo(
      path.join(this.projectPath, 'lib', 'services', 'auth_service.dart'),
      authServicioDart(this.nombreApp),
      'utf8'
    );
    await this.escribirNuevo(
      path.join(this.projectPath, 'lib', 'screens', 'login_screen.dart'),
      loginPantallaDart(this.nombreApp),
      'utf8'
    );
  }

  async generateScreens() {
    const generator = new FlutterScreenGenerator(this.entities, this.relationships, this.entidadesConApi, this.politica);
    await this.escribirNuevo(
      path.join(this.projectPath, 'lib', 'screens', 'home_screen.dart'),
      generator.generateHomeScreen(this.nombreApp),
      'utf8'
    );
    for (const entity of this.entidadesConApi) {
      const base = archivoDart(entity.name);
      await this.escribirNuevo(
        path.join(this.projectPath, 'lib', 'screens', `${base}_list_screen.dart`),
        generator.generateListScreen(entity),
        'utf8'
      );
      await this.escribirNuevo(
        path.join(this.projectPath, 'lib', 'screens', `${base}_form_screen.dart`),
        generator.generateFormScreen(entity),
        'utf8'
      );
    }
  }

  async generateMainFiles() {
    const generator = new FlutterMainGenerator(this.nombrePaquete, this.nombreApp);
    const archivos = {
      [path.join('lib', 'main.dart')]: generator.generateMain(),
      [path.join('lib', 'config', 'api_config.dart')]: generator.generateApiConfig(),
      'pubspec.yaml': generator.generatePubspec(),
      'analysis_options.yaml': generator.generateAnalysisOptions(),
      [path.join('test', 'widget_test.dart')]: generator.generateWidgetTest(),
      'README.md': generator.generateReadme(this.entidadesConApi) + this.documentarNombres() + this.documentarPermisos(),
      '⚠️ LEER_PRIMERO.txt': this.generateQuickStart()
    };
    for (const [relativa, contenido] of Object.entries(archivos)) {
      await this.escribirNuevo(path.join(this.projectPath, relativa), contenido, 'utf8');
    }
  }

  documentarNombres() {
    const rutas = this.entidadesConApi.filter(e => rutaEntidad(e.name).startsWith('entidades/'))
      .map(e => `- ${e.name}: API de la entidad en /api/${rutaEntidad(e.name)}.`);
    return '\n## Nombres de servicios y rutas\n\n' +
      'Los servicios CRUD usan archivos entidad_<nombre>_service.dart y clases Api<Nombre>Service para conservar los servicios de sesión, asistente y conexión. Los modelos conservan el nombre del diagrama.\n\n' +
      rutas.join('\n') + '\n';
  }

  documentarPermisos() {
    return '\n## Permisos de acceso\n\n' + (this.politica?.explicito
      ? 'El menú y las acciones siguen la política declarada, disponible en lib/config/permisos.dart. El backend vuelve a comprobar cada permiso y limita los registros al propietario o a las asignaciones de la cuenta. Una cuenta pendiente de vinculación necesita que administración la asocie con su registro.\n'
      : 'Sin política declarada se conserva la lectura global para usuarios con sesión. La escritura depende del permiso de gestión vigente que devuelve la API; el backend puede configurarlo con app.auth.roles-gestores.\n');
  }

  generateQuickStart() {
    return `APP FLUTTER: ${this.nombreApp}
===============================================================

Consume el backend Spring Boot generado desde el mismo diagrama (puerto 8080).

1) BACKEND
   Descomprime el Spring Boot, crea la base de datos y ejecuta:
       mvnw spring-boot:run

2) PLATAFORMAS (solo la primera vez; no sobrescribe lib/)
       flutter create .
       flutter pub get

3) EJECUTAR
       flutter run

   En un celular real, indica la IP de la PC que corre Spring Boot:
       flutter run --dart-define=API_URL=http://192.168.1.50:8080/api

Más detalles en README.md
`;
  }
}

export default FlutterProjectBuilder;
