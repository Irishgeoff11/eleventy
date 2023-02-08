const fs = require("fs");
const chalk = require("kleur");
const { TemplatePath } = require("@11ty/eleventy-utils");

const EleventyBaseError = require("./EleventyBaseError.js");
const UserConfig = require("./UserConfig.js");
const GlobalDependencyMap = require("./GlobalDependencyMap.js");

const { EleventyRequire } = require("./Util/Require.js");
const merge = require("./Util/Merge.js");
const unique = require("./Util/Unique");
const eventBus = require("./EventBus.js");

const debug = require("debug")("Eleventy:TemplateConfig");
const debugDev = require("debug")("Dev:Eleventy:TemplateConfig");

/**
 * @module 11ty/eleventy/TemplateConfig
 */

/**
 * Config as used by the template.
 * @typedef {Object} module:11ty/eleventy/TemplateConfig~TemplateConfig~config
 * @property {String=} pathPrefix - The path prefix.
 */

/**
 * Object holding override information for the template config.
 * @typedef {Object} module:11ty/eleventy/TemplateConfig~TemplateConfig~override
 * @property {String=} pathPrefix - The path prefix.
 */

/**
 * Errors in eleventy config.
 */
class EleventyConfigError extends EleventyBaseError {}

/**
 * Errors in eleventy plugins.
 */
class EleventyPluginError extends EleventyBaseError {}

/**
 * Config for a template.
 *
 * @param {{}} customRootConfig - tbd.
 * @param {String} projectConfigPath - Path to local project config.
 */
class TemplateConfig {
  constructor(customRootConfig, projectConfigPath) {
    this.userConfig = new UserConfig();

    /**
     * @member {String} - Path to local project config.
     * @default .eleventy.js
     */
    if (projectConfigPath !== undefined) {
      if (!projectConfigPath) {
        // falsy skips config files
        this.projectConfigPaths = [];
      } else {
        this.projectConfigPaths = [projectConfigPath];
      }
    } else {
      this.projectConfigPaths = [".eleventy.js", "eleventy.config.js", "eleventy.config.cjs"];
    }

    if (customRootConfig) {
      /**
       * @member {?{}} - Custom root config.
       */
      this.customRootConfig = customRootConfig;
      debug("Warning: Using custom root config!");
    } else {
      this.customRootConfig = null;
    }

    this.initializeRootConfig();
    this.hasConfigMerged = false;
  }

  /* Setter for Logger */
  setLogger(logger) {
    this.logger = logger;
  }

  /* Setter for Directories */
  setConfigOverrides(overrides) {
    this.configOverrides = overrides;
  }

  /**
   * Normalises local project config file path.
   *
   * @method
   * @returns {String} - The normalised local project config file path.
   */
  getLocalProjectConfigFile() {
    let configFiles = this.getLocalProjectConfigFiles();
    // Add the configFiles[0] in case of a test, where no file exists on the file system
    let configFile = configFiles.find((path) => path && fs.existsSync(path)) || configFiles[0];
    if (configFile) {
      return configFile;
    }
  }

  getLocalProjectConfigFiles() {
    if (this.projectConfigPaths && this.projectConfigPaths.length > 0) {
      return TemplatePath.addLeadingDotSlashArray(this.projectConfigPaths.filter((path) => path));
    }
    return [];
  }

  /**
   * Resets the configuration.
   */
  reset() {
    debugDev("Resetting configuration: TemplateConfig and UserConfig.");
    this.userConfig.reset();
    this.initializeRootConfig();
    this.forceReloadConfig();
    this.usesGraph.reset();

    // Clear the compile cache
    eventBus.emit("eleventy.compileCacheReset");
  }

  /**
   * Resets the configuration while in watch mode.
   *
   * @todo Add implementation.
   */
  resetOnWatch() {
    // nothing yet
  }

  /**
   * Force a reload of the configuration object.
   */
  forceReloadConfig() {
    this.hasConfigMerged = false;
    this.getConfig();
  }

  /**
   * Returns the config object.
   *
   * @returns {{}} - The config object.
   */
  getConfig() {
    if (!this.hasConfigMerged) {
      debugDev("Merging via getConfig (first time)");
      this.config = this.mergeConfig();
      this.hasConfigMerged = true;
    }
    return this.config;
  }

  /**
   * Gets the current path prefix denoting the root folder the output will be deployed to
   *
   *  @returns {String} - The path prefix string
   */
  getPathPrefix() {
    if (this.cfgDirOverrides.pathPrefix) {
      return this.cfgDirOverrides.pathPrefix;
    }

    if (!this.hasConfigMerged) {
      this.getConfig();
    }

    return this.config.pathPrefix;
  }

  /**
   * Bootstraps the config object.
   */
  initializeRootConfig() {
    this.rootConfig = this.customRootConfig || require("./defaultConfig.js");
    if (typeof this.rootConfig === "function") {
      this.rootConfig = this.rootConfig.call(this, this.userConfig);
      // debug( "rootConfig is a function, after calling, this.userConfig is %o", this.userConfig );
    }
    debug("rootConfig %o", this.rootConfig);
  }

  /*
   * Add additional overrides to the root config object, used for testing
   *
   * @param {Object} - a subset of the return Object from the user’s config file.
   */
  appendToRootConfig(obj) {
    Object.assign(this.rootConfig, obj);
  }

  /*
   * Process the userland plugins from the Config
   *
   * @param {Object} - the return Object from the user’s config file.
   */
  processPlugins({ dir, pathPrefix }) {
    this.userConfig.dir = dir;
    this.userConfig.pathPrefix = pathPrefix;

    if (this.logger) {
      this.userConfig.logger = this.logger;
    }

    // for Nested addPlugin calls, Issue #1925
    this.userConfig._enablePluginExecution();

    let storedActiveNamespace = this.userConfig.activeNamespace;
    for (let { plugin, options, pluginNamespace } of this.userConfig.plugins) {
      try {
        this.userConfig.activeNamespace = pluginNamespace;
        this.userConfig._executePlugin(plugin, options);
      } catch (e) {
        let name = this.userConfig._getPluginName(plugin);
        let namespaces = [storedActiveNamespace, pluginNamespace].filter((entry) => !!entry);

        let namespaceStr = "";
        if (namespaces.length) {
          namespaceStr = ` (namespace: ${namespaces.join(".")})`;
        }

        throw new EleventyPluginError(
          `Error processing ${name ? `the \`${name}\`` : "a"} plugin${namespaceStr}`,
          e
        );
      }
    }

    this.userConfig.activeNamespace = storedActiveNamespace;
  }

  get cfgOverrides() {
    if (this.configOverrides) {
      return this.configOverrides.getConfigValues();
    }

    return {};
  }

  get cfgDirOverrides() {
    if (this.configOverrides) {
      return this.configOverrides.getConfigDirValues();
    }

    return {};
  }

  /**
   * Fetches and executes the local configuration file
   *
   * @returns {{}} merged - The merged config file object.
   */
  requireLocalConfigFile() {
    // We want any CLI override values to be available in eleventyConfig.dir on first run (AND in plugins)
    this.overrideValuesFromCli(this.userConfig);

    let localConfig = {};
    let path = this.projectConfigPaths.filter((path) => path).find((path) => fs.existsSync(path));

    debug(`Merging config with ${path}`);

    if (path) {
      try {
        localConfig = EleventyRequire(path);
        // debug( "localConfig require return value: %o", localConfig );
        if (typeof localConfig === "function") {
          localConfig = localConfig(this.userConfig);
          // debug( "localConfig is a function, after calling, this.userConfig is %o", this.userConfig );

          if (typeof localConfig === "object" && typeof localConfig.then === "function") {
            throw new EleventyConfigError(
              `Error in your Eleventy config file '${path}': Returning a promise is not yet supported.`
            );
          }
        }

        // Still using removed `filters`? this was renamed to transforms
        if (
          localConfig &&
          localConfig.filters !== undefined &&
          Object.keys(localConfig.filters).length
        ) {
          throw new EleventyConfigError(
            "The `filters` configuration option was renamed in Eleventy 0.3.3 and removed in Eleventy 1.0. Please use the `addTransform` configuration method instead. Read more: https://www.11ty.dev/docs/config/#transforms"
          );
        }
      } catch (err) {
        // TODO the error message here is bad and I feel bad (needs more accurate info)
        throw new EleventyConfigError(
          `Error in your Eleventy config file '${path}'.` +
            (err.message && err.message.includes("Cannot find module")
              ? chalk.cyan(" You may need to run `npm install`.")
              : ""),
          err
        );
      }
    } else {
      debug("Eleventy local project config file not found, skipping.");
    }

    return localConfig;
  }

  overrideValuesFromCli(mergedConfig) {
    // Setup a few properties for plugins:
    // pathPrefix, formats from the CLI
    Object.assign(mergedConfig, this.cfgOverrides);

    // dirs from the CLI
    if (!mergedConfig.dir) {
      mergedConfig.dir = {};
    }
    Object.assign(mergedConfig.dir, this.cfgDirOverrides);
  }

  /**
   * Merges different config files together.
   *
   * @param {String} projectConfigPath - Path to project config.
   * @returns {{}} merged - The merged config file.
   */
  mergeConfig() {
    let localConfig = this.requireLocalConfigFile();

    // Template Formats:
    // 1. Root Config (usually defaultConfig.js)
    // 2. Local Config return object (project .eleventy.js)
    // 3. CLI via --formats (managed upstream in Eleventy.js)

    let templateFormats = this.rootConfig.templateFormats || [];
    if (localConfig && localConfig.templateFormats) {
      templateFormats = localConfig.templateFormats;
      delete localConfig.templateFormats;
    }

    let mergedConfig = merge({}, this.rootConfig, localConfig);

    this.overrideValuesFromCli(mergedConfig);

    // Returning a falsy value (e.g. "") from user config should reset to the default value.
    if (!mergedConfig.pathPrefix) {
      mergedConfig.pathPrefix = this.rootConfig.pathPrefix;
    }

    // Delay processing plugins until after the result of localConfig is returned
    // But BEFORE the rest of the config options are merged
    // this way we can pass directories and other template information to plugins

    // Temporarily restore templateFormats
    mergedConfig.templateFormats = templateFormats;

    this.processPlugins(mergedConfig);

    delete mergedConfig.templateFormats;

    let eleventyConfigApiMergingObject = this.userConfig.getMergingConfigObject();

    // `templateFormats` is an override via `setTemplateFormats`
    // `templateFormatsAdded` is additive via `addTemplateFormats`
    if (eleventyConfigApiMergingObject && eleventyConfigApiMergingObject.templateFormats) {
      templateFormats = eleventyConfigApiMergingObject.templateFormats;
      delete eleventyConfigApiMergingObject.templateFormats;
    }

    let templateFormatsAdded = eleventyConfigApiMergingObject.templateFormatsAdded || [];
    delete eleventyConfigApiMergingObject.templateFormatsAdded;

    templateFormats = unique([...templateFormats, ...templateFormatsAdded]);

    merge(mergedConfig, eleventyConfigApiMergingObject);

    this.overrideValuesFromCli(mergedConfig);

    // Restore templateFormats
    mergedConfig.templateFormats = templateFormats;

    debug("Current configuration: %o", mergedConfig);

    this.afterConfigMergeActions(mergedConfig);

    return mergedConfig;
  }

  get usesGraph() {
    if (!this._usesGraph) {
      this._usesGraph = new GlobalDependencyMap();
    }
    return this._usesGraph;
  }

  afterConfigMergeActions(eleventyConfig) {
    // Add to the merged config too
    eleventyConfig.uses = this.usesGraph;

    // this is used for the layouts event
    this.usesGraph.setConfig(eleventyConfig);
  }

  get uses() {
    if (!this.usesGraph) {
      throw new Error("The Eleventy Global Dependency Graph has not yet been initialized.");
    }
    return this.usesGraph;
  }
}

module.exports = TemplateConfig;
