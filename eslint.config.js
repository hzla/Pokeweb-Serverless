// Lint rules for patterns that have caused bugs or copy-paste drift in Pokeweb. Each message says what to do
// instead. Existing occurrences are recorded in eslint-suppressions.json; new code must not add more.
// Run `npm run lint`. After fixing old occurrences, run `npm run lint:prune` to shrink the suppressions.
import tseslint from "typescript-eslint";
import globals from "globals";

const layering = (from, banned, why) => ({
  files: [`src/${from}/**/*.ts`],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: banned.map(dir => ({ group: [`**/${dir}`, `**/${dir}/**`], message: why })),
    }],
  },
});

// A rule's options replace earlier ones for the same files, so the map block repeats these.
const localCopy = (names, message) => ({
  selector: `FunctionDeclaration[id.name=/^(${names})$/], VariableDeclarator[id.name=/^(${names})$/]`,
  message,
});
const sharedHelpers = [
  localCopy("equalBytes|sameBytes|bytesEqual", "Import equalBytes from src/nds/binary.ts instead of writing a local copy."),
  localCopy("s16|signed16|readS16|readI16", "Import toS16 / readS16 from src/nds/binary.ts instead of writing a local copy."),
];

export default tseslint.config(
  {
    ignores: ["src/assets/**", "**/*.d.ts", "dist/**", "node_modules/**", "public/**"],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: { parser: tseslint.parser, globals: { ...globals.browser } },
    plugins: { "@typescript-eslint": tseslint.plugin },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "@typescript-eslint/no-explicit-any": ["error", { fixToUnknown: false }],
    },
  },

  // Models and file formats stay independent of the UI: a model that imports a view can't be tested or reused alone.
  layering("pokeweb", ["ui"], "src/pokeweb holds models and must not import from src/ui. Move the shared code into src/pokeweb."),
  layering("nds", ["ui", "pokeweb"], "src/nds holds DS file-format code and must not import editor code. Move the shared code into src/nds."),

  // UI code: timers hide render-ordering problems, and alerts block the page with an unstyled dialog.
  {
    files: ["src/ui/**/*.ts"],
    rules: {
      "no-restricted-globals": ["error",
        { name: "setTimeout", message: "Don't defer work with a timer to dodge render order; re-render once after the change. For a real delay (debounce, animation), disable this line with a comment saying why." },
        { name: "alert", message: "Show the error next to the control or in the editor's status line instead of alert()." },
      ],
      "no-restricted-properties": ["error",
        { object: "window", property: "setTimeout", message: "Don't defer work with a timer to dodge render order; re-render once after the change. For a real delay (debounce, animation), disable this line with a comment saying why." },
        { object: "window", property: "alert", message: "Show the error next to the control or in the editor's status line instead of alert()." },
      ],
    },
  },

  // Shared binary helpers live in src/nds/binary.ts; local copies drift apart.
  {
    files: ["src/pokeweb/**/*.ts", "src/ui/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["error",
        ...sharedHelpers,
      ],
    },
  },

  // Map brushes share their stroke plumbing through src/pokeweb/mapBrushStroke.ts.
  {
    files: ["src/pokeweb/map*.ts"],
    ignores: ["src/pokeweb/mapBrushStroke.ts"],
    rules: {
      "no-restricted-syntax": ["error",
        ...sharedHelpers,
        localCopy("assertStoresMatch|permission|writePermission", "Use the shared helper from src/pokeweb/mapBrushStroke.ts instead of a local copy."),
        {
          selector: "FunctionDeclaration[id.name=/^write[A-Z]\\w*Stroke$/]",
          message: "Write brush strokes with writeBrushStroke from src/pokeweb/mapBrushStroke.ts so undo, redo and dirty tracking stay the same for every brush.",
        },
      ],
    },
  },
);
