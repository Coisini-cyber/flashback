function parse(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return { error: err.message };
  }
}

const good = parse('{"ok":true}');
const bad = parse("{not json");

console.log(good, bad);

process.on("beforeExit", () => {
  console.log("done");
});
