import { watchModule } from "../../skills/hot-reload/index.ts";
import { writeFileSync } from "fs";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: tsx hot-reload-child.ts <filePath>");
    process.exit(1);
  }

  const handle = watchModule<{ value: number }>(filePath);
  await new Promise((r) => setTimeout(r, 300));
  console.log("init:", handle.current?.value);

  writeFileSync(filePath, `export const value = 42;`, "utf-8");
  await new Promise((r) => setTimeout(r, 200));
  await handle.reload();
  console.log("reload:", handle.current?.value);

  handle.dispose();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
