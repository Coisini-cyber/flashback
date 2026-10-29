// A crash that is easy to spot and hard to explain: the upstream payload uses
// `lineItems`, but this function expects `items`.
// Run: flashback run examples/checkout.js
function parseOrder(raw) {
  const order = JSON.parse(raw);
  const total = order.items.reduce((sum, item) => sum + item.price * item.qty, 0);
  if (!order.currency) throw new Error("order is missing a currency");
  return { id: order.id, total, currency: order.currency };
}

function applyDiscount(order) {
  const rate = order.total > 100 ? 0.1 : 0.05;
  return { ...order, total: order.total * (1 - rate) };
}

function checkout(raw) {
  const order = parseOrder(raw);
  return applyDiscount(order);
}

const payload = JSON.stringify({
  id: "A-1042",
  lineItems: [{ price: 42, qty: 3 }],
  currency: "EUR",
});

const receipt = checkout(payload);
console.log("receipt", receipt);
