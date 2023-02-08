const { TemplatePath } = require("@11ty/eleventy-utils");

class EleventyConfigOverrides {
  // Raw input, might be a file or a directory
  setInput(input) {
    this.input = input;
  }

  // In current usage, this is known to be a directory
  setInputDir(inputDir) {
    this.inputDir = inputDir;
  }

  // first called via Eleventy->init()
  getInputDir(inputFallbackFromConfig) {
    if (this.inputDir) {
      // set manually via `setInputDir`, via options.inputDir in Eleventy constructor
      return this.inputDir;
    }

    // resolve via `input`
    if (!this.resolvedInputDir && (this.input || inputFallbackFromConfig)) {
      this.resolvedInputDir = TemplatePath.getDir(this.input || inputFallbackFromConfig);
    }
    return this.resolvedInputDir;
  }

  setOutput(output) {
    this.output = output;
  }

  setPathPrefix(pathPrefix) {
    this.pathPrefix = pathPrefix;
  }

  setTemplateFormats(templateFormats) {
    if (templateFormats && templateFormats !== "*") {
      this.templateFormats = templateFormats.split(",");
    }
  }

  getConfigValues() {
    let ret = {};

    if (this.pathPrefix) {
      ret.pathPrefix = this.pathPrefix;
    }

    if (this.templateFormats) {
      ret.templateFormats = this.templateFormats;
    }

    return ret;
  }

  getConfigDirValues() {
    let ret = {};
    if (this.input) {
      ret.input = this.input;

      // TODO in progress we need `data`, `includes`, and `layouts` when this.input is set
      // See Eleventy.js:
      // data: this.templateData.getDataDir(),
      // includes: this.eleventyFiles.getIncludesDir(),
      // layouts: this.eleventyFiles.getLayoutsDir(),
    }
    if (this.output) {
      ret.output = this.output;
    }

    return ret;
  }
}

module.exports = EleventyConfigOverrides;
