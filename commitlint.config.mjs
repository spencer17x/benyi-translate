export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "header-max-length": [2, "always", 100],
    "scope-case": [2, "always", "kebab-case"],
  },
  helpUrl: "https://github.com/spencer17x/benyi-translate/blob/main/CONTRIBUTING.md#提交信息",
};
