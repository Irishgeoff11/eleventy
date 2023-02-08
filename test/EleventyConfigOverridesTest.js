const test = require("ava");
const EleventyConfigOverrides = require("../src/EleventyConfigOverrides.js");

test("Constructor", (t) => {
  let d = new EleventyConfigOverrides();
  d.setInput();

  t.is(d.getInputDir(), undefined);
});
