// Copies compiled ABIs + bytecode to ../deploy/artifacts.json for the browser deploy page.
const fs = require("fs"), path = require("path");
const out = {};
for (const n of ["TestToken", "Market369X"]) {
  const a = JSON.parse(fs.readFileSync(path.join(__dirname, `../artifacts/src/${n}.sol/${n}.json`)));
  out[n] = { abi: a.abi, bytecode: a.bytecode };
}
fs.writeFileSync(path.join(__dirname, "../../deploy/artifacts.json"), JSON.stringify(out));
console.log("wrote deploy/artifacts.json");
