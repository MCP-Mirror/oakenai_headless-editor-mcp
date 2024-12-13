/** @type {import("prettier").Config} */
const config = {
  plugins: ["@ianvs/prettier-plugin-sort-imports"],
  trailingComma: "es5",
  importOrderTypeScriptVersion: "5.0.0",
  singleQuote: true,
  semi: true,
  tabWidth: 2,
  printWidth: 80
};

module.exports = config;
