# Test Examples for Web Worker Sandbox

Copy and paste these examples into the editor to test the Web Worker sandbox functionality.

## 1. Basic Console Output

```javascript
console.log("Hello, World!");
console.log("Testing multiple lines");
console.info("This is info");
console.warn("This is a warning");
console.error("This is an error");
```

**Expected Output:**
- All console statements displayed with appropriate icons
- Success message

---

## 2. Object and Array Logging

```javascript
const user = {
  name: "Alice",
  age: 25,
  hobbies: ["reading", "coding"]
};

console.log("User object:", user);
console.log("Array:", [1, 2, 3, 4, 5]);
console.log("Nested:", { a: { b: { c: "deep" } } });
```

**Expected Output:**
- Pretty-printed JSON objects
- Arrays formatted correctly

---

## 3. Mathematical Operations

```javascript
console.log("Addition:", 5 + 3);
console.log("Division:", 100 / 4);
console.log("Power:", Math.pow(2, 10));
console.log("Random:", Math.random());
console.log("PI:", Math.PI);

const sum = [1, 2, 3, 4, 5].reduce((a, b) => a + b, 0);
console.log("Sum of array:", sum);
```

**Expected Output:**
- Calculation results
- Success message

---

## 4. String Manipulation

```javascript
const text = "Hello, World!";
console.log("Original:", text);
console.log("Uppercase:", text.toUpperCase());
console.log("Lowercase:", text.toLowerCase());
console.log("Length:", text.length);
console.log("Split:", text.split(", "));
console.log("Replaced:", text.replace("World", "JavaScript"));
```

**Expected Output:**
- Various string transformations

---

## 5. Array Methods

```javascript
const numbers = [1, 2, 3, 4, 5];

console.log("Original:", numbers);
console.log("Doubled:", numbers.map(n => n * 2));
console.log("Even only:", numbers.filter(n => n % 2 === 0));
console.log("Find 3:", numbers.find(n => n === 3));
console.log("Includes 4:", numbers.includes(4));
console.log("Reversed:", [...numbers].reverse());
```

**Expected Output:**
- Array manipulation results

---

## 6. Error Handling - Runtime Error

```javascript
console.log("Starting execution...");

try {
  console.log("This will work");
  throw new Error("Custom error message");
  console.log("This won't execute");
} catch (e) {
  console.error("Caught error:", e.message);
}

console.log("Execution continues after catch");
```

**Expected Output:**
- Logs before and after error
- Caught error message
- Success completion

---

## 7. Error Handling - Uncaught Error

```javascript
console.log("About to crash...");
undefined.someMethod();
console.log("This line will never execute");
```

**Expected Output:**
- Error message: "Cannot read properties of undefined"
- Error icon
- Logs before error

---

## 8. Timeout Test - Infinite Loop

```javascript
console.log("Starting infinite loop...");
while(true) {
  // This will timeout
}
console.log("This will never execute");
```

**Expected Output:**
- Timeout message after 2 seconds
- Worker terminated message

---

## 9. Timeout Test - Long Running Loop

```javascript
console.log("Running long loop...");
let count = 0;
while(count < 1000000000) {
  count++;
}
console.log("Loop completed, count:", count);
```

**Expected Output:**
- Timeout (if loop takes > 2 seconds)
- OR completion with count value

---

## 10. Function Definitions and Execution

```javascript
function greet(name) {
  return `Hello, ${name}!`;
}

const add = (a, b) => a + b;

console.log(greet("Alice"));
console.log(greet("Bob"));
console.log("5 + 3 =", add(5, 3));

// Higher-order function
const numbers = [1, 2, 3, 4, 5];
const doubled = numbers.map(x => x * 2);
console.log("Doubled:", doubled);
```

**Expected Output:**
- Function execution results
- Greetings
- Addition result
- Mapped array

---

## 11. Type Checking

```javascript
console.log("typeof 42:", typeof 42);
console.log("typeof 'hello':", typeof "hello");
console.log("typeof true:", typeof true);
console.log("typeof undefined:", typeof undefined);
console.log("typeof null:", typeof null);
console.log("typeof {}:", typeof {});
console.log("typeof []:", typeof []);
console.log("typeof function:", typeof function() {});
```

**Expected Output:**
- Type information for different values

---

## 12. JSON Operations

```javascript
const data = {
  name: "Product",
  price: 99.99,
  inStock: true,
  tags: ["new", "sale"]
};

const jsonString = JSON.stringify(data);
console.log("JSON string:", jsonString);

const parsed = JSON.parse(jsonString);
console.log("Parsed back:", parsed);
console.log("Price:", parsed.price);
```

**Expected Output:**
- JSON string representation
- Parsed object
- Specific field value

---

## 13. Date and Time

```javascript
const now = new Date();
console.log("Current date:", now.toString());
console.log("ISO format:", now.toISOString());
console.log("Year:", now.getFullYear());
console.log("Month:", now.getMonth() + 1);
console.log("Day:", now.getDate());
console.log("Timestamp:", now.getTime());
```

**Expected Output:**
- Various date formats
- Date components
- Timestamp

---

## 14. Regular Expressions

```javascript
const text = "The quick brown fox jumps over the lazy dog";
const pattern = /quick.*fox/;

console.log("Original:", text);
console.log("Match:", text.match(pattern));
console.log("Test:", pattern.test(text));
console.log("Replace:", text.replace(/dog/, "cat"));
console.log("Split:", text.split(" "));
```

**Expected Output:**
- Regex match results
- Test results
- Replaced text

---

## 15. Multiple Console Types

```javascript
console.log("=== Testing All Console Types ===");
console.log("Standard log message");
console.info("Informational message");
console.warn("Warning message - something might be wrong");
console.error("Error message - something is wrong");

console.log("\n=== Objects ===");
console.log({ status: "ok", code: 200 });

console.log("\n=== Arrays ===");
console.log([1, "two", { three: 3 }, [4, 5]]);

console.log("\n=== Done ===");
```

**Expected Output:**
- Different console message types with appropriate icons
- Formatted objects and arrays

---

## 16. Null and Undefined Handling

```javascript
let x;
let y = null;
let z = undefined;

console.log("Uninitialized variable:", x);
console.log("Null variable:", y);
console.log("Undefined variable:", z);
console.log("x === undefined:", x === undefined);
console.log("y === null:", y === null);
console.log("typeof null:", typeof null);
console.log("typeof undefined:", typeof undefined);
```

**Expected Output:**
- Null and undefined values displayed correctly
- Type comparisons

---

## 17. Recursive Function

```javascript
function factorial(n) {
  console.log(`Calculating factorial(${n})`);
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

const result = factorial(5);
console.log("5! =", result);
```

**Expected Output:**
- Recursive calls logged
- Final factorial result (120)

---

## 18. Closure Example

```javascript
function createCounter() {
  let count = 0;
  return {
    increment: () => ++count,
    decrement: () => --count,
    get: () => count
  };
}

const counter = createCounter();
console.log("Initial:", counter.get());
console.log("After increment:", counter.increment());
console.log("After increment:", counter.increment());
console.log("After decrement:", counter.decrement());
console.log("Final:", counter.get());
```

**Expected Output:**
- Counter operations results
- Demonstrates closure working in worker

---

## 19. Template Literals

```javascript
const name = "Alice";
const age = 25;
const job = "Developer";

console.log(`Name: ${name}`);
console.log(`Age: ${age}`);
console.log(`Job: ${job}`);
console.log(`Summary: ${name} is ${age} years old and works as a ${job}.`);

const multiline = `
  This is a
  multi-line
  string
`;
console.log(multiline);
```

**Expected Output:**
- Template literal interpolations
- Multi-line string

---

## 20. Edge Cases and Special Values

```javascript
console.log("Infinity:", Infinity);
console.log("Negative Infinity:", -Infinity);
console.log("NaN:", NaN);
console.log("isNaN(NaN):", isNaN(NaN));
console.log("1/0:", 1/0);
console.log("0/0:", 0/0);
console.log("Math.sqrt(-1):", Math.sqrt(-1));
console.log("Empty string:", "");
console.log("Boolean true:", true);
console.log("Boolean false:", false);
```

**Expected Output:**
- Special JavaScript values displayed correctly

---

## How to Test

1. Copy any example above
2. Paste into the Monaco editor
3. Click "Run (Quick)"
4. Observe the output in the right panel
5. Try modifying the examples to test different scenarios

## Testing Strategy

- ✅ Test normal execution (Examples 1-5)
- ✅ Test error handling (Examples 6-7)
- ✅ Test timeout protection (Examples 8-9)
- ✅ Test complex operations (Examples 10-20)
- ✅ Test edge cases (Example 20)

