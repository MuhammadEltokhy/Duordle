// Classic Wordle color algorithm, with correct duplicate-letter handling
// (two-pass: greens first, then yellows against remaining letter counts).
function computeColors(guess, answer) {
  const g = guess.toUpperCase().split('');
  const a = answer.toUpperCase().split('');
  const result = new Array(g.length).fill('gray');
  const remaining = {};

  for (let i = 0; i < g.length; i++) {
    if (g[i] === a[i]) {
      result[i] = 'green';
    } else {
      remaining[a[i]] = (remaining[a[i]] || 0) + 1;
    }
  }

  for (let i = 0; i < g.length; i++) {
    if (result[i] === 'green') continue;
    if (remaining[g[i]] > 0) {
      result[i] = 'yellow';
      remaining[g[i]] -= 1;
    }
  }

  return result;
}

function isSolved(colors) {
  return colors.every((c) => c === 'green');
}

module.exports = { computeColors, isSolved };
