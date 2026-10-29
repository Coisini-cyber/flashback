// A classic off-by-one bug: the loop stops one comparison too early.
// Run: flashback run examples/binary-search.js
function binarySearch(sorted, target) {
  let lo = 0;
  let hi = sorted.length - 1;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (sorted[mid] === target) return mid;
    if (sorted[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }

  return -1;
}

const sorted = [1, 3, 5, 7, 9, 11, 13, 15];
const target = 15;
const index = binarySearch(sorted, target);

console.log(`searching for ${target} in [${sorted}]`);
console.log(`result: ${index}`);
console.log(index === sorted.length - 1 ? "ok" : "BUG: element not found");
