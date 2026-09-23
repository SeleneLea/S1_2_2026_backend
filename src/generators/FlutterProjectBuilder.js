import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import DiagramParser from './DiagramParser.js';
import FlutterModelGenerator from './FlutterModelGenerator.js';
import FlutterServiceGenerator from './FlutterServiceGenerator.js';
import FlutterScreenGenerator from './FlutterScreenGenerator.js';
import FlutterMainGenerator from './FlutterMainGenerator.js';
import { archivoDart, esAbstracta, esAuxiliar } from './FlutterNombres.js';

class FlutterProjectBuilder {
  /**
   * @param {string} projectName  nombre de la carpeta temporal (lleva timestamp)
   * @param {string} xmlString    diagrama convertido
   * @param {string} basePath     carpeta temporal de exportaciones
   * @param {{ nombreApp?: string }} opciones  nombre visible y del paquete Dart
   */
  constructor(projectName, xmlString, basePath, { nombreApp } = {}) {
    this.projectName = this.sanitizeProjectName(projectName);
    this.nombreApp = nombreApp || projectName;
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
      const parser = new DiagramParser();
      const parsedDiagram = parser.parse(this.xmlString);
      this.relationships = parsedDiagram.relationships || [];
      // Mismo criterio que el backend: interfaces y enumeraciones no son entidades,
      // y las clases abstractas no tienen API propia (sus campos van en las hijas).
      this.entities = parsedDiagram.entities.filter(e => !esAuxiliar(e));
      this.entidadesConApi = this.entities.filter(e => !esAbstracta(e));

      await this.createProjectStructure();
      await this.generateModels();
      await this.generateServices();
      await this.generateScreens();
      await this.generateMainFiles();
    } catch (error) {
      console.error('❌ Error construyendo proyecto Flutter:', error);
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
      await fs.writeFile(filePath, generator.generate(entity), 'utf8');
    }
  }

  async generateServices() {
    const generator = new FlutterServiceGenerator(this.entities, this.relationships, this.entidadesConApi);
    await fs.writeFile(
      path.join(this.projectPath, 'lib', 'services', 'base_service.dart'),
      generator.generateBaseService(),
      'utf8'
    );
    for (const entity of this.entidadesConApi) {
      const filePath = path.join(this.projectPath, 'lib', 'services', `${archivoDart(entity.name)}_service.dart`);
      await fs.writeFile(filePath, generator.generate(entity), 'utf8');
    }
  }

  async generateScreens() {
    const generator = new FlutterScreenGenerator(this.entities, this.relationships, this.entidadesConApi);
    await fs.writeFile(
      path.join(this.projectPath, 'lib', 'screens', 'home_screen.dart'),
      generator.generateHomeScreen(this.nombreApp),
      'utf8'
    );
    for (const entity of this.entidadesConApi) {
      const base = archivoDart(entity.name);
      await fs.writeFile(
        path.join(this.projectPath, 'lib', 'screens', `${base}_list_screen.dart`),
        generator.generateListScreen(entity),
        'utf8'
      );
      await fs.writeFile(
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
      'README.md': generator.generateReadme(this.entidadesConApi),
      '⚠️ LEER_PRIMERO.txt': this.generateQuickStart()
    };
    for (const [relativa, contenido] of Object.entries(archivos)) {
      await fs.writeFile(path.join(this.projectPath, relativa), contenido, 'utf8');
    }
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
