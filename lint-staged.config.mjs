export default {
  "*.{css,html,json,js,mjs,ts,yaml,yml}": "prettier --write",
  "src/**/*.ts": () => "pnpm run check:code",
};
