#!/usr/bin/env node
import { main } from "../src/cli.js";

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`flashback: ${err?.stack ?? err}\n`);
  process.exit(1);
});
