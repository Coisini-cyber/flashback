async function loadUser(id) {
  const started = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const user = { id, name: null };
  user.name = await Promise.resolve("ada");
  user.elapsed = Date.now() - started;
  return user;
}

async function main() {
  const user = await loadUser(7);
  const greeting = `hello ${user.name}`;
  console.log(greeting);
  return greeting;
}

main();
