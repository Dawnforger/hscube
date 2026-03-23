const { defineConfig } = require("vite");
const packageJson = require("./package.json");

module.exports = defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
});
