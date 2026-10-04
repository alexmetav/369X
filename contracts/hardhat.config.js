require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
const path = require("path");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// Use the solc compiler bundled in node_modules (no download needed)
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === "0.8.24") {
    return { compilerPath: path.join(__dirname, "node_modules", "solc", "soljson.js"), isSolcJs: true,
      version: args.solcVersion, longVersion: require("solc/package.json").version };
  }
  return runSuper();
});

module.exports = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true } },
  paths: { sources: "./src", tests: "./test" },
  // local test chain pretends to be BSC Testnet (97) so the deploy page can be tested end to end
  networks: { hardhat: { chainId: Number(process.env.CHAIN_ID || 31337) } }
};
