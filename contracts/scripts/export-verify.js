// Writes ../deploy/verify.json: the exact compiler input, so the deploy page can submit the
// contracts' source code to Sourcify (public verification, no API key) from the browser.
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "../artifacts/build-info");
const infos = fs.readdirSync(dir).map(f => JSON.parse(fs.readFileSync(path.join(dir, f))));
const names = ["TestToken", "Market369X", "Vault369X", "Stake369X", "Referral369X"];
const info = infos.find(b => names.every(n => b.input.sources[`src/${n}.sol`]));
if (!info) throw new Error("Run `npx hardhat compile --force` first (one build with every contract)");
const input = { ...info.input, settings: { ...info.input.settings, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"] } } } };
const version = require("solc").version().replace(/\.Emscripten.*$/, "");
fs.writeFileSync(path.join(__dirname, "../../deploy/verify.json"), JSON.stringify({ compilerVersion: version, input,
  ids: Object.fromEntries(names.map(n => [n, `src/${n}.sol:${n}`])) }));
console.log("wrote deploy/verify.json", version);
