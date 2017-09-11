'use strict';

const del = require('del');
const gulp = require('gulp');
const gulpif = require('gulp-if');
const uglifyes = require('uglify-es');
const composer = require('gulp-uglify/composer');
const cssSlam = require('css-slam').gulp;
const mergeStream = require('merge-stream');
const polymerBuild = require('polymer-build');
const browserSync = require('browser-sync').create();
const history = require('connect-history-api-fallback');

const HtmlSplitter = polymerBuild.HtmlSplitter;
const PolymerProject = polymerBuild.PolymerProject;
const uglify = composer(uglifyes, console);

const logging = require('plylog');
// logging.setVerbose();

const config = {
  polymerJsonPath: './polymer.json',
  build: {
    rootDirectory: 'build'
  },
  swPrecacheConfigPath: './sw-precache-config.js',
  templateData: [
    'data/hoverboard.config',
    'data/resources'
  ],
  tempDirectory: '.temp'
};
const swPrecacheConfig = require(config.swPrecacheConfigPath);
const polymerJson = require(config.polymerJsonPath);
const buildPolymerJson = {
  entrypoint: prependPath(config.tempDirectory, polymerJson.entrypoint),
  shell: prependPath(config.tempDirectory, polymerJson.shell),
  fragments: polymerJson.fragments.reduce((res, el) => [...res, prependPath(config.tempDirectory, el)], []),
  sources: polymerJson.sources.reduce((res, el) => [...res, prependPath(config.tempDirectory, el)], []),
  extraDependencies: polymerJson.extraDependencies
};

const normalize = require('./gulp-tasks/normalize.js');
const template = require('./gulp-tasks/template.js');
const images = require('./gulp-tasks/images.js');
const html = require('./gulp-tasks/html.js');


function build() {
  return new Promise(resolve => {
    let polymerProject = null;
    console.log(`Deleting ${config.build.rootDirectory} and ${config.tempDirectory} directories...`);

    del([config.build.rootDirectory, config.tempDirectory])
      .then(() => {
        console.log(`Compiling template...`);

        const compileStream = template.compile(config, polymerJson)
          .on('end', () => {
            polymerProject = new PolymerProject(buildPolymerJson);
          });
        return waitFor(compileStream);
      })
      .then(() => {
        console.log(`Polymer building...`);

        const sourcesHtmlSplitter = new HtmlSplitter();
        const sourcesStream = polymerProject.sources()
          .pipe(sourcesHtmlSplitter.split())
          .pipe(gulpif(/\.js$/, uglify()))
          .pipe(gulpif(/\.(html|css)$/, cssSlam()))
          .pipe(gulpif(/\.html$/, html.minify()))
          .pipe(gulpif(/\.(png|gif|jpg|svg)$/, images.minify()))
          .pipe(sourcesHtmlSplitter.rejoin());

        const dependenciesHtmlSplitter = new HtmlSplitter();
        const dependenciesStream = polymerProject.dependencies()
          .pipe(dependenciesHtmlSplitter.split())
          // Doesn't work for now
          .pipe(gulpif(/\.js$/, uglify()))
          .pipe(gulpif(/\.(html|css)$/, cssSlam()))
          .pipe(gulpif(/\.html$/, html.minify()))
          .pipe(dependenciesHtmlSplitter.rejoin());

        let buildStream = mergeStream(sourcesStream, dependenciesStream)
          .once('data', () => {
            console.log('Analyzing and optimizing...');
          });

        buildStream = buildStream.pipe(polymerProject.bundler({
          stripComments: true
        }));
        buildStream = buildStream.pipe(gulp.dest(config.build.rootDirectory));
        return waitFor(buildStream);
      })
      .then(() => {
        console.log('Generating the Service Worker...');

        return polymerBuild.addServiceWorker({
          project: polymerProject,
          buildRoot: prependPath(config.build.rootDirectory, config.tempDirectory).replace('\\', '/'),
          bundled: config.build.bundled,
          swPrecacheConfig
        });
      })
      .then(() => {
        console.log('Normalizing...');

        const normalizeStream = normalize(config)
          .on('end', () => {
            del([prependPath(config.build.rootDirectory, config.tempDirectory)])
          });

        return waitFor(normalizeStream);
      })
      .then(() => {
        return gulp.src(prependPath(config.build.rootDirectory, 'service-worker.js'))
          .pipe(uglify())
          .pipe(gulp.dest(config.build.rootDirectory));
      })
      .then(() => {
        console.log('Build complete!');
        resolve();
      });
  });
}

function waitFor(stream) {
  return new Promise((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
  });
}

function reload(done) {
  browserSync.reload();
  done();
}

function compileTemplate() {
  return del([config.tempDirectory])
    .then(() => {
      return waitFor(template.compile(config, polymerJson));
    });
}

function copyStatic() {
  return gulp.src([
    'data/**/*.{markdown,md}',
    'images/**/*.{png,gif,jpg,svg}'
  ], {base: '.'})
    .pipe(gulp.dest(config.tempDirectory));
}

function prependPath(pre, to) {
  return `${pre}/${to}`;
}

gulp.task('default', build);

gulp.task('serve', gulp.series(compileTemplate, () => {
  browserSync.init({
    logPrefix: 'Hoverboard 2',
    notify: false,
    server: {
      baseDir: [config.tempDirectory, './'],
      middleware: [history()]
    }
  });

  gulp.watch([
    'data/**/*.{markdown,md}',
    'images/**/*.{png,gif,jpg,svg}',
  ], gulp.series(copyStatic, reload));

  gulp.watch([
    'data/**/*.json',
    'scripts/**/*.js',
    'src/**/*.html',
    '*.{html,js}',
    'manifest.json'
  ], gulp.series(compileTemplate, reload));
}));

