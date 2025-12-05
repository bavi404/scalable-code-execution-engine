// Sample solution: Add two numbers
// Reads two space-separated integers and prints their sum

const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  const [a, b] = line.split(' ').map(Number);
  console.log(a + b);
  rl.close();
});

