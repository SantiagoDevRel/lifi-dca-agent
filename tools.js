// tools.js
// ─────────────────────────────────────────────────────────────
// Handles all external API calls and side effects the agent can trigger.
// This is the "hands" of the agent — Claude decides what to do,
// this file actually does it.
// Responsible for:
//   - Calling LI.FI API to get swap quotes
//   - Calling LI.FI API to check transfer status
//   - Saving/loading the DCA config to config.json
//   - Executing on-chain transactions via wallet.js
// ─────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const { sendTransaction, getWalletAddress } = require("./wallet");
require("dotenv").config();

// Path to the config file where the DCA rule is stored
const CONFIG_PATH = path.join(__dirname, "config.json");

// Base URL for LI.FI's public API (no API key needed under 200 req/2hr)
const LIFI_BASE_URL = "https://li.quest/v1";

// ─────────────────────────────────────────────────────────────
// getQuote()
// Calls LI.FI's /quote endpoint to get the best available route
// for a token swap or bridge.
// Returns the full quote object including transactionRequest
// (i.e., ready-to-sign tx data) and estimated output amount.
// ─────────────────────────────────────────────────────────────
async function getQuote({ fromChain, toChain, fromToken, toToken, fromAmount, fromAddress }) {
  const params = new URLSearchParams({
    fromChain,
    toChain,
    fromToken,
    toToken,
    fromAmount,
    fromAddress,
    // slippage of 0.5% — max acceptable price movement during execution
    slippage: "0.005"
  });

  const response = await fetch(`${LIFI_BASE_URL}/quote?${params}`);
  const data = await response.json();

  // If LI.FI returns an error, surface it clearly
  if (data.message) {
    throw new Error(`LI.FI quote error: ${data.message}`);
  }

  return {
    tool: data.tool,                          // bridge or DEX used (e.g. "stargate")
    toAmount: data.estimate?.toAmount,        // expected output in wei
    toAmountMin: data.estimate?.toAmountMin,  // minimum output after slippage
    feeCosts: data.estimate?.feeCosts,        // array of fees
    gasCosts: data.estimate?.gasCosts,        // estimated gas cost
    transactionRequest: data.transactionRequest // ready-to-sign tx object
  };
}

// ─────────────────────────────────────────────────────────────
// getStatus()
// Polls LI.FI's /status endpoint to check if a cross-chain
// transfer has completed, is still pending, or has failed.
// txHash — the transaction hash returned after sending a tx
// ─────────────────────────────────────────────────────────────
async function getStatus({ txHash, fromChain, toChain }) {
  const params = new URLSearchParams({ txHash });

  // fromChain and toChain are optional but speed up the response
  if (fromChain) params.append("fromChain", fromChain);
  if (toChain) params.append("toChain", toChain);

  const response = await fetch(`${LIFI_BASE_URL}/status?${params}`);
  const data = await response.json();

  return {
    status: data.status,       // NOT_FOUND | PENDING | DONE | FAILED
    substatus: data.substatus, // e.g. COMPLETED, PARTIAL, REFUNDED
    txLink: data.txLink        // block explorer link for the tx
  };
}

// ─────────────────────────────────────────────────────────────
// saveConfig()
// Writes the DCA rule to config.json so the agent remembers it
// across loop iterations.
// Called by Claude when the user gives a new instruction.
// ─────────────────────────────────────────────────────────────
async function saveConfig({ instruction, interval_minutes, from_token, to_token, amount_wei }) {
  const config = {
    active: true,
    instruction,
    interval_minutes,
    from_token,
    to_token,
    amount_wei,
    updated_at: new Date().toISOString()
  };

  // Write config as formatted JSON so it's human-readable
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log(`💾 Config saved: ${JSON.stringify(config)}`);

  return { success: true, config };
}

// ─────────────────────────────────────────────────────────────
// loadConfig()
// Reads the current DCA rule from config.json.
// Returns null if no config exists yet.
// ─────────────────────────────────────────────────────────────
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;

  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(raw);
}

// ─────────────────────────────────────────────────────────────
// executeSwap()
// Takes the transactionRequest from a LI.FI quote and sends it
// on-chain via our wallet.
// This is the point of no return — once called, the tx is submitted.
// ─────────────────────────────────────────────────────────────
async function executeSwap({ to, data, value, gasLimit }) {
  const txHash = await sendTransaction({ to, data, value, gasLimit });
  return { success: true, txHash };
}

// ─────────────────────────────────────────────────────────────
// executeTool()
// Router function — Claude returns a tool name and input object,
// this function maps that to the correct implementation above.
// This is what agent.js calls after Claude decides to use a tool.
// ─────────────────────────────────────────────────────────────
async function executeTool(toolName, toolInput) {
  switch (toolName) {
    case "get_quote":
      return await getQuote(toolInput);
    case "get_status":
      return await getStatus(toolInput);
    case "save_config":
      return await saveConfig(toolInput);
    case "execute_swap":
      return await executeSwap(toolInput);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

module.exports = { executeTool, loadConfig };