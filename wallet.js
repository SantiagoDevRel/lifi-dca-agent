// wallet.js
// ─────────────────────────────────────────────────────────────
// Handles everything related to the wallet and blockchain connection.
// Uses viem — a lightweight JS library for interacting with EVM chains.
// Responsible for:
//   - Connecting to Base testnet
//   - Loading the wallet from the private key in .env
//   - Reading the wallet's ETH balance
//   - Signing and sending transactions on-chain
// ─────────────────────────────────────────────────────────────

const { createWalletClient, createPublicClient, http, parseEther, formatEther } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { base } = require("viem/chains");
require("dotenv").config();

// Load private key from .env and derive the wallet account object
// privateKeyToAccount() turns a raw private key string into a viem account
// that can sign transactions
const account = privateKeyToAccount(process.env.PRIVATE_KEY);

// publicClient — read-only connection to Base
// Used for reading balances, estimating gas, waiting for tx receipts
// (a "receipt" is the confirmation you get after a transaction is mined)
const publicClient = createPublicClient({
    chain: base,
    transport: http()
  });

// walletClient — connection that can sign and send transactions
// Needs the account (private key) to sign
const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http()
  });

// getWalletAddress()
// Returns the public wallet address derived from the private key
function getWalletAddress() {
  return account.address;
}

// getETHBalance()
// Reads the current ETH balance of our wallet from the chain
// Returns it as a human-readable string like "0.0523"
async function getETHBalance() {
  const balanceWei = await publicClient.getBalance({ address: account.address });
  return formatEther(balanceWei); // converts wei to ETH (18 decimals)
}

// sendTransaction()
// Takes raw transaction data from a LI.FI quote and submits it on-chain
// Returns the transaction hash (a unique ID for the submitted tx)
// Params:
//   to       — contract address to call
//   data     — encoded calldata (instructions for the contract)
//   value    — ETH to send along with the tx, in wei
//   gasLimit — max gas units allowed (prevents runaway costs)
async function sendTransaction({ to, data, value, gasLimit }) {
  const txHash = await walletClient.sendTransaction({
    to,
    data,
    value: BigInt(value),      // viem requires BigInt for wei values
    gas: gasLimit ? BigInt(gasLimit) : undefined
  });

  console.log(`📤 Transaction sent: ${txHash}`);

  // Wait for the transaction to be mined and get the receipt
  // waitForTransactionReceipt() polls the chain until the tx is confirmed
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);

  return txHash;
}

module.exports = { getWalletAddress, getETHBalance, sendTransaction };