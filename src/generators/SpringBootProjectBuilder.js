import path from 'path';
import fs from 'fs';
import { rm } from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname_gen = path.dirname(fileURLToPath(import.meta.url));
import DiagramParser from './DiagramParser.js';
import MetadataBuilder from './MetadataBuilder.js';
import { controladorAsistente, propiedadesAsistente, servicioAsistente } from './AsistenteGenerator.js';
import {
    controladorAuth, detectarRoles, entidadUsuario, filtroAuth, propiedadesAuth, repositorioUsuario, servicioAuth
} from './AuthGenerator.js';
import EntityGenerator from './EntityGenerator.js';
import ManyToManyEntityGenerator from './ManyToManyEntityGenerator.js';
import RepositoryGenerator from './RepositoryGenerator.js';
import ServiceGenerator from './ServiceGenerator.js';
import ControllerGenerator from './ControllerGenerator.js';
import ReadmeGenerator from './ReadmeGenerator.js';
import DTOGenerator from './DTOGenerator.js';
import MapperGenerator from './MapperGenerator.js';

class SpringBootProjectBuilder {

    constructor(titulo, xmlString, rutaBase, { dbName, nombreProyecto, proposito } = {}) {
        this.titulo = titulo;
        // Nombre visible del proyecto (artifactId, JAR, README). El titulo de la
        // carpeta temporal lleva un timestamp que no debe llegar al proyecto.
        this.nombreProyecto = nombreProyecto || titulo;
        // De qué trata el sistema: lo escribe el diagramador al exportar y lo usa el asistente
        this.proposito = proposito || '';
        this.xmlString = xmlString;
        this.rutaBase = rutaBase;
        this.projectPath = path.join(rutaBase, titulo);
        // Lo normal es recibir el nombre de la BD del controlador (el mismo que usa
        // el script SQL). Si no llega, se deriva del titulo sin el timestamp que
        // lleva para evitar colisiones de carpeta.
        this.dbName = dbName || String(titulo)
            .replace(/[-_]?\d{10,}$/, '')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '') || 'app_db';
        this.diagramParser = new DiagramParser();
        this.parsedDiagram = null;
        this.metadata = null;
    }

    async build() {
        this.parsedDiagram = this.diagramParser.parse(this.xmlString);
        const metadataBuilder = new MetadataBuilder(
            this.parsedDiagram.entities,
            this.parsedDiagram.relationships
        );
        this.metadata = metadataBuilder.build();

        // UML 2.5: interfaces y enumeraciones NO son entidades JPA. Se apartan
        // aqui para que ningun generador (entidad, repositorio, servicio,
        // controlador, DTO, mapper) intente persistirlas.
        const esAuxiliar = (e) => e.stereotype === 'interface' || e.stereotype === 'enumeration';
        this.auxiliares = this.parsedDiagram.entities.filter(esAuxiliar);
        this.parsedDiagram.entities = this.parsedDiagram.entities.filter(e => !esAuxiliar(e));

        // Las clases abstractas se generan como entidad (la herencia las necesita)
        // pero NO reciben CRUD propio: no se pueden instanciar.
        this.entidadesConcretas = this.parsedDiagram.entities.filter(
            e => !(e.isAbstract || e.stereotype === 'abstract')
        );
        await this.cleanDirectory();
        this.createDirectoryStructure();
        this.generateConfigFiles();
        this.generateEntities();
    this.generateManyToManyEntities();
        this.generateDTOs();
        this.generateMappers();
        this.generateRepositories();
        this.generateServices();
        this.generateControllers();
        this.generateConfigClasses();
        this.generateAutenticacion();
        this.generateAsistente();
        this.generateMainApplication();
        this.generateAuxiliares();
        this.generateReadme();
        this.copyMavenWrapper();
    }

    /**
     * Inicio de sesión con roles: los roles salen de las clases de personas del diagrama
     * (Cliente, Entrenador, Médico…). Todos consultan; solo los de gestión modifican datos.
     */
    generateAutenticacion() {
        const roles = detectarRoles(this.entidadesConcretas);
        this.rolesDelSistema = roles;
        const base = path.join(this.projectPath, 'src/main/java/com/example/demo');
        const archivos = [
            ['entities/Usuario.java', entidadUsuario()],
            ['repositories/UsuarioRepository.java', repositorioUsuario()],
            ['services/AuthService.java', servicioAuth(roles)],
            ['controllers/AuthController.java', controladorAuth()],
            ['config/AuthFiltro.java', filtroAuth()],
        ];
        for (const [relativo, contenido] of archivos) {
            const destino = path.join(base, relativo);
            fs.mkdirSync(path.dirname(destino), { recursive: true });
            fs.writeFileSync(destino, contenido);
        }
        const propiedades = path.join(this.projectPath, 'src/main/resources/application.properties');
        if (fs.existsSync(propiedades)) fs.appendFileSync(propiedades, propiedadesAuth(roles));
        console.log(`✅ Inicio de sesión generado con los roles: ${roles.map(r => r.rol).join(', ')}`);
    }

    /**
     * Asistente de IA del proyecto: endpoint /api/asistente que responde preguntas sobre el
     * sistema. La clave del servicio se toma de la variable de entorno, nunca del código.
     */
    generateAsistente() {
        const servicios = path.join(this.projectPath, 'src/main/java/com/example/demo/services');
        const controladores = path.join(this.projectPath, 'src/main/java/com/example/demo/controllers');
        fs.mkdirSync(servicios, { recursive: true });
        fs.mkdirSync(controladores, { recursive: true });
        fs.writeFileSync(
            path.join(servicios, 'AsistenteService.java'),
            servicioAsistente(this.nombreProyecto, this.entidadesConcretas, this.parsedDiagram.relationships, this.proposito)
        );
        fs.writeFileSync(
            path.join(controladores, 'AsistenteController.java'),
            controladorAsistente(this.nombreProyecto)
        );
        // La configuración del asistente se agrega al final de application.properties
        const propiedades = path.join(this.projectPath, 'src/main/resources/application.properties');
        if (fs.existsSync(propiedades)) {
            fs.appendFileSync(propiedades, propiedadesAsistente());
        }
        console.log('✅ Asistente de IA generado (endpoint /api/asistente)');
    }

    /**
     * Copia el Maven Wrapper al proyecto generado. Sin esto el ZIP exige tener
     * Maven instalado; con el wrapper basta con Java (se descarga Maven solo).
     * Es del tipo only-script: no necesita el .jar del wrapper.
     */
    copyMavenWrapper() {
        const origen = path.join(__dirname_gen, 'templates', 'maven-wrapper');
        if (!fs.existsSync(origen)) {
            console.warn('Maven Wrapper: plantilla no encontrada en', origen);
            return;
        }
        const copiar = (desde, hacia) => {
            fs.mkdirSync(path.dirname(hacia), { recursive: true });
            fs.copyFileSync(desde, hacia);
        };
        copiar(path.join(origen, 'mvnw'), path.join(this.projectPath, 'mvnw'));
        copiar(path.join(origen, 'mvnw.cmd'), path.join(this.projectPath, 'mvnw.cmd'));
        copiar(
            path.join(origen, '.mvn', 'wrapper', 'maven-wrapper.properties'),
            path.join(this.projectPath, '.mvn', 'wrapper', 'maven-wrapper.properties')
        );
        // Permiso de ejecucion para mvnw en Linux/macOS (en Windows es indiferente)
        try { fs.chmodSync(path.join(this.projectPath, 'mvnw'), 0o755); } catch (e) { /* noop */ }
    }

    async cleanDirectory() {
        if (fs.existsSync(this.projectPath)) {
            await rm(this.projectPath, { recursive: true, force: true });
        }
    }

    createDirectoryStructure() {
        const dirs = [
            'src/main/java/com/example/demo/entities',
            'src/main/java/com/example/demo/repositories',
            'src/main/java/com/example/demo/services',
            'src/main/java/com/example/demo/controllers',
            'src/main/java/com/example/demo/config',
            'src/main/java/com/example/demo/exceptions',
            'src/main/java/com/example/demo/dto',
            'src/main/java/com/example/demo/mappers',
            'src/main/resources',
            'src/test/java/com/example/demo'
        ];
        dirs.forEach(dir => {
            const fullPath = path.join(this.projectPath, dir);
            fs.mkdirSync(fullPath, { recursive: true });
        });
    }

    generateConfigFiles() {
        this.generatePomXml();
        this.generateApplicationProperties();
        this.generateApplicationYml();
    }

    generatePomXml() {
        const pom = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 
         https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.2.0</version>
        <relativePath/>
    </parent>
    
    <groupId>com.example</groupId>
    <artifactId>${this.nombreProyecto}</artifactId>
    <version>1.0.0</version>
    <name>${this.nombreProyecto}</name>
    <description>Proyecto Spring Boot generado desde diagrama UML</description>
    
    <properties>
        <java.version>17</java.version>
        <maven.compiler.source>17</maven.compiler.source>
        <maven.compiler.target>17</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    </properties>
    
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
        </dependency>
        
        <dependency>
            <groupId>org.postgresql</groupId>
            <artifactId>postgresql</artifactId>
            <scope>runtime</scope>
        </dependency>
        
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-validation</artifactId>
        </dependency>
        
        <dependency>
            <groupId>com.fasterxml.jackson.datatype</groupId>
            <artifactId>jackson-datatype-hibernate5-jakarta</artifactId>
        </dependency>
        
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-devtools</artifactId>
            <scope>runtime</scope>
            <optional>true</optional>
        </dependency>
        
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>
    
    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <version>3.11.0</version>
                <configuration>
                    <source>17</source>
                    <target>17</target>
                    <encoding>UTF-8</encoding>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
`;
        fs.writeFileSync(path.join(this.projectPath, 'pom.xml'), pom);
    }

    generateApplicationProperties() {
        const dbName = this.dbName;
        const props = `# ===================================================================
# CONFIGURACIÓN DE SPRING BOOT - ${this.nombreProyecto}
# ===================================================================

# Puerto del servidor
server.port=8080

# CONFIGURACIÓN DE BASE DE DATOS POSTGRESQL
# ===================================================================
spring.datasource.url=jdbc:postgresql://localhost:5432/${dbName}
spring.datasource.username=postgres
spring.datasource.password=postgres
spring.datasource.driver-class-name=org.postgresql.Driver

# Pool de conexiones Hikari
spring.datasource.hikari.maximum-pool-size=10
spring.datasource.hikari.minimum-idle=5
spring.datasource.hikari.connection-timeout=30000
spring.datasource.hikari.idle-timeout=600000
spring.datasource.hikari.max-lifetime=1800000

# ===================================================================
# CONFIGURACIÓN DE JPA/HIBERNATE
# ===================================================================
# Estrategia DDL: update, create, create-drop, validate, none
spring.jpa.hibernate.ddl-auto=update

# Mostrar SQL en consola
spring.jpa.show-sql=true
spring.jpa.properties.hibernate.format_sql=true

# Dialecto PostgreSQL
spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.PostgreSQLDialect

# Naming strategy (convierte camelCase a snake_case)
spring.jpa.hibernate.naming.physical-strategy=org.hibernate.boot.model.naming.CamelCaseToUnderscoresNamingStrategy
spring.jpa.hibernate.naming.implicit-strategy=org.springframework.boot.orm.jpa.hibernate.SpringImplicitNamingStrategy

# Configuración de fetching
spring.jpa.properties.hibernate.enable_lazy_load_no_trans=true
spring.jpa.open-in-view=false

# Estadísticas de Hibernate
spring.jpa.properties.hibernate.generate_statistics=false

# ===================================================================
# CONFIGURACIÓN DE LOGGING
# ===================================================================
logging.level.root=INFO
logging.level.com.example.demo=DEBUG
logging.level.org.springframework.web=DEBUG
logging.level.org.hibernate.SQL=DEBUG
logging.level.org.hibernate.type.descriptor.sql.BasicBinder=TRACE
logging.level.org.hibernate.stat=DEBUG

# ===================================================================
# CONFIGURACIÓN DE JACKSON (JSON)
# ===================================================================
spring.jackson.serialization.fail-on-empty-beans=false
spring.jackson.serialization.write-dates-as-timestamps=false
spring.jackson.default-property-inclusion=non_null
spring.jackson.deserialization.fail-on-unknown-properties=false

# ===================================================================
# CONFIGURACIÓN DE SPRING MVC
# ===================================================================
spring.mvc.throw-exception-if-no-handler-found=true
spring.web.resources.add-mappings=false

spring.validation.enabled=true

spring.transaction.default-timeout=30
`;
        fs.writeFileSync(
            path.join(this.projectPath, 'src/main/resources/application.properties'),
            props
        );
    }

    generateApplicationYml() {
        const dbName = this.dbName;
        const yml = `# Configuración alternativa en formato YAML
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/${dbName}
    username: postgres
    password: postgres
    driver-class-name: org.postgresql.Driver
    hikari:
      maximum-pool-size: 10
      minimum-idle: 5
      connection-timeout: 30000
  
  jpa:
    hibernate:
      ddl-auto: update
      naming:
        physical-strategy: org.hibernate.boot.model.naming.CamelCaseToUnderscoresNamingStrategy
    show-sql: true
    properties:
      hibernate:
        dialect: org.hibernate.dialect.PostgreSQLDialect
        format_sql: true
  
  jackson:
    serialization:
      fail-on-empty-beans: false
      write-dates-as-timestamps: false
    default-property-inclusion: non_null

server:
  port: 8080

logging:
  level:
    root: INFO
    com.example.demo: DEBUG
    org.springframework.web: DEBUG
    org.hibernate.SQL: DEBUG
`;
        fs.writeFileSync(
            path.join(this.projectPath, 'src/main/resources/application.yml.example'),
            yml
        );
    }

    generateEntities() {
        const entityGenerator = new EntityGenerator(
            this.parsedDiagram.entities,
            this.parsedDiagram.relationships,
            this.parsedDiagram.manyToManyTables || []
        );
        const entities = entityGenerator.generateAll();
        const entitiesPath = path.join(this.projectPath, 'src/main/java/com/example/demo/entities');
        entities.forEach(entity => {
            fs.writeFileSync(path.join(entitiesPath, entity.name), entity.content);
        });
    }

    generateManyToManyEntities() {
        const tables = this.parsedDiagram.manyToManyTables || [];
        if (!tables || tables.length === 0) return;
        const mmGenerator = new ManyToManyEntityGenerator(tables, this.parsedDiagram.entities);
        const generated = mmGenerator.generateAll();
        const entitiesPath = path.join(this.projectPath, 'src/main/java/com/example/demo/entities');
        generated.forEach(tbl => {
            fs.writeFileSync(path.join(entitiesPath, tbl.name), tbl.content);
        });
    }

    generateDTOs() {
        const dtoGenerator = new DTOGenerator(
            this.entidadesConcretas,
            this.parsedDiagram.relationships
        );
        const dtos = dtoGenerator.generateAll();
        const dtoPath = path.join(this.projectPath, 'src/main/java/com/example/demo/dto');
        dtos.forEach(dto => {
            fs.writeFileSync(path.join(dtoPath, dto.name), dto.content);
        });
    }

    generateRepositories() {
        const repoGenerator = new RepositoryGenerator(
            this.entidadesConcretas,
            this.parsedDiagram.relationships,
            this.metadata
        );
        const repositories = repoGenerator.generateAll();
        const repoPath = path.join(this.projectPath, 'src/main/java/com/example/demo/repositories');
        repositories.forEach(repo => {
            fs.writeFileSync(path.join(repoPath, repo.name), repo.content);
        });
    }

    generateServices() {
        const serviceGenerator = new ServiceGenerator(
            this.entidadesConcretas,
            this.parsedDiagram.relationships,
            this.metadata
        );
        const services = serviceGenerator.generateAll();
        const servicePath = path.join(this.projectPath, 'src/main/java/com/example/demo/services');
        services.forEach(service => {
            fs.writeFileSync(path.join(servicePath, service.name), service.content);
        });
    }

    generateControllers() {
        const controllerGenerator = new ControllerGenerator(
            this.entidadesConcretas,
            this.parsedDiagram.relationships,
            this.metadata
        );
        const controllers = controllerGenerator.generateAll();
        const controllerPath = path.join(this.projectPath, 'src/main/java/com/example/demo/controllers');
        controllers.forEach(controller => {
            fs.writeFileSync(path.join(controllerPath, controller.name), controller.content);
        });
    }

    generateMappers() {
        const mapperGenerator = new MapperGenerator(
            this.entidadesConcretas,
            this.parsedDiagram.relationships,
            this.metadata
        );
        const mappers = mapperGenerator.generateAll();
        const mapperPath = path.join(this.projectPath, 'src/main/java/com/example/demo/mappers');
        mappers.forEach(mapper => {
            fs.writeFileSync(path.join(mapperPath, mapper.name), mapper.content);
        });
    }

    generateConfigClasses() {
        this.generateCorsConfig();
        this.generateGlobalExceptionHandler();
        this.generateWebConfig();
        this.generateJacksonConfig();
        this.generateEntityIdDeserializer();
    }

    generateCorsConfig() {
        const corsConfig = `package com.example.demo.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.util.Arrays;
import java.util.List;

/**
 * Configuración CORS para permitir peticiones desde Flutter y otras aplicaciones cliente
 * Esta configuración es necesaria para que el frontend móvil (Flutter) pueda
 * comunicarse con el backend Spring Boot
 */
@Configuration
public class CorsConfig {

    @Bean
    public CorsFilter corsFilter() {
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        CorsConfiguration config = new CorsConfiguration();
        
        // Permitir credenciales (cookies, authorization headers, etc.)
        config.setAllowCredentials(true);
        
        // Permitir todos los orígenes (en producción, especifica los dominios permitidos)
        // Para Flutter local: http://localhost:*, http://10.0.2.2:*, etc.
        config.addAllowedOriginPattern("*");
        
        // Permitir todos los headers
        config.addAllowedHeader("*");
        
        // Métodos HTTP permitidos
        config.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"));
        
        // Tiempo de caché para preflight requests (OPTIONS)
        config.setMaxAge(3600L);
        
        // Headers expuestos al cliente
        config.setExposedHeaders(Arrays.asList(
            "Authorization",
            "Content-Type",
            "Accept",
            "X-Requested-With",
            "Access-Control-Allow-Origin",
            "Access-Control-Allow-Credentials"
        ));
        
        // Aplicar configuración a todas las rutas /api/**
        source.registerCorsConfiguration("/api/**", config);
        
        // También aplicar a la raíz por si acaso
        source.registerCorsConfiguration("/**", config);
        
        return new CorsFilter(source);
    }
}
`;

        const configPath = path.join(this.projectPath, 'src/main/java/com/example/demo/config');
        fs.writeFileSync(path.join(configPath, 'CorsConfig.java'), corsConfig);
    }

    generateWebConfig() {
        const webConfig = `package com.example.demo.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

// Sin @EnableWebMvc: esa anotación apaga la configuración automática de Spring
// Boot, se ignoraba JacksonConfig y las fechas salían como [2026, 9, 13, 10, 30]
@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/**")
                .addResourceLocations("classpath:/static/");
    }
}
`;

        const configPath = path.join(this.projectPath, 'src/main/java/com/example/demo/config');
        fs.writeFileSync(path.join(configPath, 'WebConfig.java'), webConfig);
    }

    generateGlobalExceptionHandler() {
        const exceptionHandler = `package com.example.demo.exceptions;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;

import org.springframework.core.NestedExceptionUtils;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import jakarta.validation.ConstraintViolationException;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    // Antes cualquier RuntimeException respondía 404, incluso un error de base de
    // datos o un JSON mal formado. Cada caso tiene ahora su código HTTP.

    @ExceptionHandler(RecursoNoEncontradoException.class)
    public ResponseEntity<Map<String, Object>> handleNoEncontrado(
            RecursoNoEncontradoException ex, WebRequest request) {
        return respuesta(HttpStatus.NOT_FOUND, ex.getMessage(), request);
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<Map<String, Object>> handleIntegridad(
            DataIntegrityViolationException ex, WebRequest request) {
        return respuesta(HttpStatus.CONFLICT,
            "La base de datos rechazó la operación: el registro tiene datos relacionados o viola una restricción",
            request);
    }

    @ExceptionHandler({
        ConstraintViolationException.class,
        IllegalArgumentException.class,
        HttpMessageNotReadableException.class,
        MethodArgumentTypeMismatchException.class
    })
    public ResponseEntity<Map<String, Object>> handleDatosInvalidos(Exception ex, WebRequest request) {
        return respuesta(HttpStatus.BAD_REQUEST,
            "Datos inválidos: " + NestedExceptionUtils.getMostSpecificCause(ex).getMessage(),
            request);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> handleValidationExceptions(
            MethodArgumentNotValidException ex, WebRequest request) {

        Map<String, String> errors = new HashMap<>();
        ex.getBindingResult().getAllErrors().forEach((error) -> {
            String fieldName = error instanceof FieldError campo ? campo.getField() : error.getObjectName();
            String errorMessage = error.getDefaultMessage();
            errors.put(fieldName, errorMessage);
        });
        
        Map<String, Object> body = new HashMap<>();
        body.put("success", false);
        body.put("timestamp", LocalDateTime.now());
        body.put("message", "Errores de validación");
        body.put("errors", errors);
        
        return new ResponseEntity<>(body, HttpStatus.BAD_REQUEST);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGlobalException(
            Exception ex, WebRequest request) {
        
        Map<String, Object> body = new HashMap<>();
        body.put("success", false);
        body.put("timestamp", LocalDateTime.now());
        body.put("message", "Error interno del servidor");
        body.put("details", ex.getMessage());
        body.put("path", request.getDescription(false).replace("uri=", ""));
        
        return new ResponseEntity<>(body, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    private ResponseEntity<Map<String, Object>> respuesta(HttpStatus estado, String mensaje, WebRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("success", false);
        body.put("timestamp", LocalDateTime.now());
        body.put("message", mensaje);
        body.put("path", request.getDescription(false).replace("uri=", ""));
        return new ResponseEntity<>(body, estado);
    }
}
`;
        const exceptionsPath = path.join(this.projectPath, 'src/main/java/com/example/demo/exceptions');
        fs.writeFileSync(path.join(exceptionsPath, 'GlobalExceptionHandler.java'), exceptionHandler);

        // Excepción de "no encontrado": servicios y controladores responden 404 con ella
        fs.writeFileSync(path.join(exceptionsPath, 'RecursoNoEncontradoException.java'), `package com.example.demo.exceptions;

/**
 * Se lanza cuando un registro, o una entidad referenciada por una clave foránea,
 * no existe. Los controladores y el manejador global la traducen a HTTP 404.
 */
public class RecursoNoEncontradoException extends RuntimeException {

    public RecursoNoEncontradoException(String mensaje) {
        super(mensaje);
    }
}
`);

        // Compatibilidad del servidor web: en algunos Windows Java no puede abrir el
        // Selector de NIO y Tomcat no arranca. Se detecta y se usa el conector NIO2.
        fs.writeFileSync(path.join(this.projectPath, 'src/main/java/com/example/demo/config/ServidorWebConfig.java'), `package com.example.demo.config;

import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.IOException;
import java.nio.channels.Selector;

/**
 * Compatibilidad del servidor web con algunos equipos Windows.
 *
 * El conector NIO de Tomcat abre un Selector de Java, que en Windows crea un canal
 * interno por socket AF_UNIX. En ciertos equipos ese canal no se puede crear y la
 * aplicación no arranca ("Unable to establish loopback connection"). Si ocurre,
 * se usa el conector NIO2, que trabaja con IOCP y no lo necesita. En el resto de
 * equipos no cambia nada.
 */
@Configuration
public class ServidorWebConfig {

    @Bean
    public WebServerFactoryCustomizer<TomcatServletWebServerFactory> conectorCompatible() {
        return factory -> {
            try (Selector selector = Selector.open()) {
                // NIO disponible: se mantiene el conector por defecto
            } catch (IOException e) {
                System.out.println("NIO no disponible en este equipo (" + e.getMessage()
                    + "): se usa el conector NIO2 de Tomcat");
                factory.setProtocol("org.apache.coyote.http11.Http11Nio2Protocol");
            }
        };
    }
}
`);
    }

    generateMainApplication() {
        const mainApp = `package com.example.demo;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class DemoApplication {

    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
        System.out.println("\\n==============================================");
        System.out.println("🚀 Aplicación ${this.nombreProyecto} iniciada");
        System.out.println("📡 API REST disponible en: http://localhost:8080/api");
        System.out.println("==============================================\\n");
    }
}
`;
        fs.writeFileSync(
            path.join(this.projectPath, 'src/main/java/com/example/demo/DemoApplication.java'),
            mainApp
        );
    }

    /**
     * Genera interfaces y enumeraciones como Java plano (sin anotaciones JPA).
     */
    generateAuxiliares() {
        const aux = this.auxiliares || [];
        if (aux.length === 0) return;
        const destino = path.join(this.projectPath, 'src/main/java/com/example/demo/model');
        fs.mkdirSync(destino, { recursive: true });

        aux.forEach(item => {
            let contenido;
            if (item.stereotype === 'enumeration') {
                const literales = (item.attributes || [])
                    .filter(a => !a.isPrimaryKey)
                    .map(a => String(a.name || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_'))
                    .filter(Boolean);
                const cuerpo = literales.length ? literales.join(',' + String.fromCharCode(10) + '    ') : 'SIN_VALORES';
                contenido = `package com.example.demo.model;

/**
 * Enumeracion generada desde el diagrama UML.
 */
public enum ${item.name} {
    ${cuerpo}
}
`;
            } else {
                const firmas = (item.methods || []).map(m => {
                    const texto = typeof m === 'string' ? m : (m.name || 'metodo');
                    const limpio = texto.replace(new RegExp('^[+' + String.fromCharCode(92) + '-#~]\\s*'), '').trim();
                    const abre = limpio.indexOf('(');
                    const cierra = limpio.lastIndexOf(')');
                    if (abre === -1 || cierra === -1) return `    void ${limpio.replace(/[^A-Za-z0-9_]/g, '')}();`;
                    const nombre = limpio.slice(0, abre).trim();
                    const params = limpio.slice(abre + 1, cierra).trim();
                    const despues = limpio.slice(cierra + 1).trim();
                    const retorno = despues.startsWith(':') ? (despues.slice(1).trim() || 'void') : 'void';
                    // UML escribe "nombre: Tipo"; Java necesita "Tipo nombre"
                    const paramsJava = params
                        ? params.split(',').map(par => {
                            const trozos = par.split(':');
                            const pn = (trozos[0] || 'param').trim();
                            const pt = (trozos[1] || 'String').trim();
                            return `${pt} ${pn}`;
                        }).join(', ')
                        : '';
                    return `    ${retorno} ${nombre}(${paramsJava});`;
                });
                const cuerpo = firmas.length ? firmas.join(String.fromCharCode(10)) : '    // Sin operaciones definidas';
                contenido = `package com.example.demo.model;

/**
 * Interfaz generada desde el diagrama UML.
 */
public interface ${item.name} {
${cuerpo}
}
`;
            }
            fs.writeFileSync(path.join(destino, `${item.name}.java`), contenido);
        });
        console.log(`Generados ${aux.length} clasificadores auxiliares (interfaces/enums)`);
    }

    generateReadme() {
        const readmeGenerator = new ReadmeGenerator();
        const readmeContent = readmeGenerator.generate(this.nombreProyecto, this.parsedDiagram.entities, this.dbName);
        fs.writeFileSync(path.join(this.projectPath, 'README.md'), readmeContent);
        this.generateQuickStartGuide();
        this.generateGitignore();
    }

    generateQuickStartGuide() {
        const quickStart = `╔════════════════════════════════════════════════════════════════════╗
║                                                                    ║
║    🚀 GUÍA RÁPIDA - Spring Boot Backend (Puerto 8080)             ║
║                                                                    ║
╚════════════════════════════════════════════════════════════════════╝

Este es el backend Spring Boot que tu aplicación Flutter va a consumir.

═══════════════════════════════════════════════════════════════════════
PASO 1: CONFIGURAR BASE DE DATOS
═══════════════════════════════════════════════════════════════════════

Opción A: PostgreSQL (Recomendado)
-----------------------------------
1. Instala PostgreSQL
2. Crea la base de datos:

   CREATE DATABASE ${this.dbName};

   Las tablas las crea Spring Boot al arrancar. Si prefieres crearlas a mano,
   el script está en database/${this.dbName}.sql:

   psql -U postgres -d ${this.dbName} -f database/${this.dbName}.sql

3. Edita src/main/resources/application.properties:
   
   spring.datasource.username=tu_usuario
   spring.datasource.password=tu_password

Opción B: H2 (Base de datos en memoria - para testing)
-------------------------------------------------------
Cambia en application.properties:
spring.jpa.hibernate.ddl-auto=create-drop

═══════════════════════════════════════════════════════════════════════
PASO 2: EJECUTAR EL BACKEND
═══════════════════════════════════════════════════════════════════════

En Windows:
-----------
./mvnw clean install
./mvnw spring-boot:run

En Mac/Linux:
-------------
./mvnw clean install
./mvnw spring-boot:run

⏱️  Espera a ver: "Started DemoApplication in X seconds"

═══════════════════════════════════════════════════════════════════════
PASO 3: VERIFICAR QUE FUNCIONA
═══════════════════════════════════════════════════════════════════════

Abre tu navegador o usa curl:

http://localhost:8080/api

Deberías ver una respuesta JSON (aunque sea un error de "no encontrado")

═══════════════════════════════════════════════════════════════════════
ASISTENTE DE IA (opcional)
═══════════════════════════════════════════════════════════════════════

El backend trae un asistente que responde preguntas sobre el sistema:

   POST http://localhost:8080/api/asistente   { "pregunta": "¿qué datos pide un cliente?" }
   GET  http://localhost:8080/api/asistente/estado

Ya sabe de qué trata este proyecto y qué guarda cada clase. Prueba los servicios
en orden: primero Gemini y, si se queda sin cuota o falla, DeepSeek. Las claves NO
se escriben en el código:

   Windows:  setx GEMINI_API_KEY "tu-clave"
             setx DEEPSEEK_API_KEY "tu-clave"    (y reinicia la terminal)
   Linux:    export GEMINI_API_KEY="tu-clave"
             export DEEPSEEK_API_KEY="tu-clave"

Con una sola de las dos ya funciona; el orden se cambia en application.properties
(asistente.orden).

Sin clave, la app móvil igual responde con su asistente sin internet.

═══════════════════════════════════════════════════════════════════════
PASO 4: CONFIGURAR FLUTTER PARA CONECTARSE
═══════════════════════════════════════════════════════════════════════

En tu proyecto Flutter, edita: lib/config/api_config.dart

Para iOS/Mac:
  static const String baseUrl = 'http://localhost:8080/api';

Para Android Emulator:
  static const String baseUrl = 'http://10.0.2.2:8080/api';

Para Dispositivo Físico:
  1. Obtén tu IP: ipconfig (Windows) o ifconfig (Mac/Linux)
  2. Usa: static const String baseUrl = 'http://TU_IP:8080/api';

═══════════════════════════════════════════════════════════════════════
CONFIGURACIÓN CORS (YA INCLUIDA)
═══════════════════════════════════════════════════════════════════════

✅ CORS está HABILITADO en src/main/java/com/example/demo/config/CorsConfig.java
✅ Permite peticiones desde cualquier origen (*)
✅ Soporta todos los métodos HTTP
✅ Permite todos los headers

No necesitas configurar nada adicional!

═══════════════════════════════════════════════════════════════════════
ENDPOINTS DISPONIBLES
═══════════════════════════════════════════════════════════════════════

Todos los endpoints están bajo /api

Ejemplos:
  GET    http://localhost:8080/api/nombreentidad
  POST   http://localhost:8080/api/nombreentidad
  GET    http://localhost:8080/api/nombreentidad/{id}
  PUT    http://localhost:8080/api/nombreentidad/{id}
  DELETE http://localhost:8080/api/nombreentidad/{id}

═══════════════════════════════════════════════════════════════════════
TROUBLESHOOTING
═══════════════════════════════════════════════════════════════════════

❌ Error: "Failed to configure a DataSource"
   → Verifica que PostgreSQL esté corriendo
   → Verifica las credenciales en application.properties

❌ Error: "Connection refused" desde Flutter
   → Verifica que Spring Boot esté corriendo (puerto 8080)
   → Para Android: usa 10.0.2.2 en lugar de localhost
   → Verifica firewall/antivirus

❌ Error: "Port 8080 already in use"
   → Otro proceso usa el puerto 8080
   → Cambia el puerto en application.properties: server.port=8081

═══════════════════════════════════════════════════════════════════════
COMANDOS ÚTILES
═══════════════════════════════════════════════════════════════════════

Compilar:
  ./mvnw clean install

Ejecutar:
  ./mvnw spring-boot:run

Ejecutar con perfil específico:
  ./mvnw spring-boot:run -Dspring-boot.run.profiles=dev

Ver logs en tiempo real:
  tail -f logs/application.log

═══════════════════════════════════════════════════════════════════════

📖 Para más detalles, consulta README.md

🔗 Documentación Spring Boot: https://spring.io/projects/spring-boot
`;
        fs.writeFileSync(path.join(this.projectPath, '⚠️ INICIO_RAPIDO.txt'), quickStart);
    }

    generateGitignore() {
        const gitignore = `# Compiled class files
*.class

# Log files
*.log

# Maven
target/
pom.xml.tag
pom.xml.releaseBackup
pom.xml.versionsBackup
pom.xml.next
release.properties
dependency-reduced-pom.xml

# Gradle
.gradle/
build/

# IntelliJ IDEA
.idea/
*.iml
*.iws
*.ipr
out/

# Eclipse
.classpath
.project
.settings/
bin/

# NetBeans
/nbproject/private/
/nbbuild/
/dist/
/nbdist/
/.nb-gradle/

# VS Code
.vscode/

# macOS
.DS_Store

# Windows
Thumbs.db

# Application specific
application-local.properties
application-dev.properties

# Spring Boot DevTools
spring-boot-devtools.properties
`;
        fs.writeFileSync(path.join(this.projectPath, '.gitignore'), gitignore);
    }

    generateJacksonConfig() {
        const jacksonConfig = `package com.example.demo.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.fasterxml.jackson.datatype.hibernate5.jakarta.Hibernate5JakartaModule;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;

@Configuration
public class JacksonConfig {

    @Bean
    public ObjectMapper objectMapper(Jackson2ObjectMapperBuilder builder) {
        ObjectMapper objectMapper = builder.createXmlMapper(false).build();
        
        // Módulo para manejar proxies de Hibernate
        Hibernate5JakartaModule hibernateModule = new Hibernate5JakartaModule();
        hibernateModule.enable(Hibernate5JakartaModule.Feature.FORCE_LAZY_LOADING);
        objectMapper.registerModule(hibernateModule);
        
        // Configurar para manejar fechas correctamente
        objectMapper.registerModule(new JavaTimeModule());
        objectMapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        
        // Evitar problemas con referencias circulares
        objectMapper.configure(SerializationFeature.FAIL_ON_EMPTY_BEANS, false);
        
        // Nombres en camelCase, igual que los campos de los DTO: es el contrato que usa
        // la app Flutter generada (antes se declaraba SNAKE_CASE y no coincidía)
        objectMapper.setPropertyNamingStrategy(PropertyNamingStrategies.LOWER_CAMEL_CASE);
        
        // Aceptar propiedades desconocidas sin fallar
        objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        
        // Aceptar nombres de propiedades de forma case-insensitive
        objectMapper.configure(MapperFeature.ACCEPT_CASE_INSENSITIVE_PROPERTIES, true);
        
        return objectMapper;
    }
}
`;
        const configPath = path.join(this.projectPath, 'src/main/java/com/example/demo/config');
        fs.writeFileSync(path.join(configPath, 'JacksonConfig.java'), jacksonConfig);
    }

    generateEntityIdDeserializer() {
        const deserializerCode = `package com.example.demo.config;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;

/**
 * Deserializador personalizado para entidades JPA
 * Permite enviar solo el ID de una entidad relacionada
 * Ejemplo: { "codigoNuevaclase": 123 } crea un objeto Nuevaclase temporal con codigo=123
 * El Service luego resolverá la entidad completa desde la base de datos
 */
@Component
public class EntityIdDeserializer extends JsonDeserializer<Object> {

    @Override
    public Object deserialize(JsonParser jsonParser, DeserializationContext context) throws IOException {
        JsonNode node = jsonParser.getCodec().readTree(jsonParser);
        
        // Si el valor es null, retornar null
        if (node.isNull()) {
            return null;
        }
        
        // Si es un número o texto (ID), crear un objeto temporal con solo el ID
        if (node.isNumber() || node.isTextual()) {
            try {
                // Obtener el tipo de clase de la entidad
                Class<?> entityClass = context.getContextualType().getRawClass();
                
                // Crear una nueva instancia de la entidad
                Constructor<?> constructor = entityClass.getDeclaredConstructor();
                constructor.setAccessible(true);
                Object entity = constructor.newInstance();
                
                // Convertir el ID al tipo correcto
                Object id;
                if (node.isNumber()) {
                    id = node.asLong();
                } else {
                    id = node.asText();
                }
                
                // Buscar el setter del ID (buscar métodos que empiecen con "set")
                // Intentar con diferentes nombres comunes de PK
                String[] possibleIdSetters = {"setId", "setCodigo", "setKey", "setPk"};
                boolean setterFound = false;
                
                for (String setterName : possibleIdSetters) {
                    try {
                        Method setter = findSetterMethod(entityClass, setterName);
                        if (setter != null) {
                            // Convertir el ID al tipo del parámetro del setter
                            Class<?> paramType = setter.getParameterTypes()[0];
                            Object convertedId = convertId(id, paramType);
                            setter.invoke(entity, convertedId);
                            setterFound = true;
                            break;
                        }
                    } catch (Exception e) {
                        // Intentar con el siguiente setter
                        continue;
                    }
                }
                
                // Si no se encontró un setter estándar, buscar cualquier setter que acepte el tipo de ID
                if (!setterFound) {
                    for (Method method : entityClass.getDeclaredMethods()) {
                        if (method.getName().startsWith("set") && method.getParameterCount() == 1) {
                            try {
                                Class<?> paramType = method.getParameterTypes()[0];
                                if (isNumericType(paramType) || paramType.equals(String.class)) {
                                    Object convertedId = convertId(id, paramType);
                                    method.invoke(entity, convertedId);
                                    setterFound = true;
                                    break;
                                }
                            } catch (Exception e) {
                                // Intentar con el siguiente setter
                                continue;
                            }
                        }
                    }
                }
                
                return entity;
            } catch (Exception e) {
                System.err.println("Error en EntityIdDeserializer: " + e.getMessage());
                e.printStackTrace();
                return null;
            }
        }
        
        // Si es un objeto completo, deserializar normalmente
        return context.readValue(jsonParser, context.getContextualType());
    }
    
    private Method findSetterMethod(Class<?> clazz, String setterName) {
        try {
            // Intentar con diferentes tipos de parámetros
            Class<?>[] possibleTypes = {Long.class, long.class, Integer.class, int.class, String.class};
            for (Class<?> type : possibleTypes) {
                try {
                    return clazz.getMethod(setterName, type);
                } catch (NoSuchMethodException e) {
                    // Intentar con el siguiente tipo
                    continue;
                }
            }
        } catch (Exception e) {
            return null;
        }
        return null;
    }
    
    private Object convertId(Object id, Class<?> targetType) {
        if (targetType.equals(Long.class) || targetType.equals(long.class)) {
            if (id instanceof Number) {
                return ((Number) id).longValue();
            }
            return Long.parseLong(id.toString());
        } else if (targetType.equals(Integer.class) || targetType.equals(int.class)) {
            if (id instanceof Number) {
                return ((Number) id).intValue();
            }
            return Integer.parseInt(id.toString());
        } else if (targetType.equals(String.class)) {
            return id.toString();
        }
        return id;
    }
    
    private boolean isNumericType(Class<?> type) {
        return type.equals(Long.class) || type.equals(long.class) ||
               type.equals(Integer.class) || type.equals(int.class) ||
               type.equals(Double.class) || type.equals(double.class) ||
               type.equals(Float.class) || type.equals(float.class);
    }
}
`;
        const configPath = path.join(this.projectPath, 'src/main/java/com/example/demo/config');
        fs.writeFileSync(path.join(configPath, 'EntityIdDeserializer.java'), deserializerCode);
    }

    getProjectPath() {
        return this.projectPath;
    }
}

export default SpringBootProjectBuilder;