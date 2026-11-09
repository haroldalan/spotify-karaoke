// Client for driver.mjs.  node tools/live/ctl.mjs <cmd> [json-args | js]
//   ctl eval '<js expr>'   ctl sw '<js expr>'   ctl shot '{"file":"x.png"}'
//   ctl click '{"selector":"..."}'   ctl reload '{"ext":true}'   ctl logs '{"match":"sk"}'
const [cmd, raw] = process.argv.slice(2);
let args = {};
if (raw) {
  if (cmd === 'eval' || cmd === 'sw') args = { js: raw };
  else args = JSON.parse(raw);
}
const res = await fetch('http://127.0.0.1:9444/', { method: 'POST', body: JSON.stringify({ cmd, ...args }) });
const data = await res.json();
if (!data.ok) { console.error(data.error); process.exit(1); }
console.log(typeof data.out === 'string' ? data.out : JSON.stringify(data.out, null, 1));
