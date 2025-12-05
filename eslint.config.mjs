import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
    { files: ["**/*.{js,mjs,cjs,ts}"] },
    {
        languageOptions: {
            globals: globals.node,
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        }
    },
    pluginJs.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
        }
    },
    {
        ignores: ["dist/", "coverage/", "node_modules/", "eslint.config.mjs"]
    }
];
