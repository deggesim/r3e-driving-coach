// CODE_STYLE.md compliance check — runs after every Write/Edit on .ts/.tsx files
import { readFileSync } from "fs";

const input = readFileSync(process.stdin.fd, "utf8");
const event = JSON.parse(input);
const filePath = event?.tool_input?.file_path ?? "";

if (!filePath || !/\.(ts|tsx)$/.test(filePath)) process.exit(0);

let lines;
try {
  lines = readFileSync(filePath, "utf8").split(/\r?\n/);
} catch {
  process.exit(0);
}

const violations = [];

for (let i = 0; i < lines.length; i++) {
  const n = i + 1;
  const stripped = lines[i].replace(/^\s*\/\/.+/, "");

  if (/\bfunction\b/.test(stripped))
    violations.push(`L${n}: 'function' keyword — use arrow function instead`);

  if (/\bclass\b/.test(stripped))
    violations.push(`L${n}: 'class' keyword — use factory function instead`);

  if (/process\.env\./.test(stripped))
    violations.push(`L${n}: 'process.env' — use 'import.meta.env'`);

  if (/import \* as .+from '@fortawesome/.test(stripped))
    violations.push(`L${n}: FontAwesome wildcard import — import icons individually`);
}

if (violations.length > 0) {
  const fileName = filePath.split(/[\\/]/).at(-1);
  const msg = `CODE_STYLE.md check — ${fileName} — ${violations.length} violation(s):\n${violations.join("\n")}`;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: msg,
      },
    })
  );
}
