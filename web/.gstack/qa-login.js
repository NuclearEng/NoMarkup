// QA login helper — run via: node web/.gstack/qa-login.js <email> <role>
// Logs in via the API proxy and prints the access token for use in tests.
const email = process.argv[2];
if (!email) { console.error('Usage: node qa-login.js <email>'); process.exit(1); }

const pw = process.env.QA_PASSWORD;
if (!pw) { console.error('Set QA_PASSWORD env var'); process.exit(1); }

fetch('http://localhost:3000/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: pw }),
}).then(r => {
  if (!r.ok) { console.error('Login failed:', r.status); process.exit(1); }
  return r.json();
}).then(d => {
  // Output just the token
  console.log(d.access_token);
});
