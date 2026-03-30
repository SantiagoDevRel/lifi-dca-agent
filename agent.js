// agent.js
// ─────────────────────────────────────────────────────────────
// Main entry point for the DCA agent.
// This file contains two modes:
//
//   1. CONFIGURE mode — run with an instruction argument:
//      node agent.js "swap 0.001 ETH to USDC every 3 minutes"
//      Claude parses the instruction, calls save_config tool,
//      then exits.
//
//   2. RUN mode — run with no arguments:
//      node agent.js
//      Loads config.json, starts the autonomous loop.
//      Every X minutes Claude decides whether to execute a swap.
//
// The agent loop (RUN mode):
//   1. Load config (interval, tokens, amount)
//   2. Ask Claude: "should I swap now? here's the config"
//   3. Claude calls get_quote tool → we execute it → feed result back
//   4. Claude calls execute_swap tool → we execute it → feed result back
//   5. Claude summarizes what happened
//   6. Wait interval_minutes, repeat from step 2
// ─────────────────────────────────────────────────────────────

const Anthropic = require("@anthropic-ai/sdk");
const cron = require("node-cron");
const { executeTool, loadConfig } = require("./tools");
const { getWalletAddress, getETHBalance } = require("./wallet");
const toolDefs = require("./toolDefs");
require("dotenv").config();

const client = new Anthropic();

// System prompt — tells Claude its role and constraints
// This runs on every loop iteration so Claude always has context
const SYSTEM_PROMPT = `You are an autonomous DCA (Dollar-Cost Averaging) agent managing a crypto wallet on Base Sepolia testnet.

Your job:
- When given a user instruction, parse it and call save_config to store the DCA rule
- When running autonomously, call get_quote to check the current swap, then call execute_swap to execute it
- After executing, optionally call get_status to confirm the transfer

Rules:
- Always call get_quote then IMMEDIATELY call execute_swap in the same response — no intermediate reasoning between them
- Never call get_quote and wait — quotes expire in ~30 seconds
- Base mainnet chain ID is 8453
- Keep responses concise — you are logging to a terminal, not chatting
- If a quote looks unreasonable (fees > 10% of amount), skip and log why`;



// ─────────────────────────────────────────────────────────────
// runAgentLoop()
// The core agent loop — sends a message to Claude, processes
// any tool calls it returns, feeds results back, repeats until
// Claude returns a final text response with no more tool calls.
//
// This is the raw tool-use loop:
//   send message → get tool_use response → execute tool →
//   append tool_result → send again → repeat until text response
// ─────────────────────────────────────────────────────────────
async function runAgentLoop(userMessage) {
  console.log(`\n🤖 Agent triggered: ${new Date().toLocaleTimeString()}`);
  console.log(`📝 Message: ${userMessage}\n`);

  // messages array holds the full conversation history for this loop
  // Claude has no memory between calls — we must pass everything each time
  const messages = [
    { role: "user", content: userMessage }
  ];

  // Keep looping until Claude gives a plain text response (no more tool calls)
  while (true) {
    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: toolDefs,
      messages
    });

    console.log(`🧠 Claude stop reason: ${response.stop_reason}`);

    // If Claude returned a plain text response, we're done
    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find(b => b.type === "text");
      if (textBlock) {
        console.log(`\n💬 Claude: ${textBlock.text}\n`);
      }
      break;
    }

    // If Claude wants to use tools, process each tool call
    if (response.stop_reason === "tool_use") {
      // Append Claude's response (with tool_use blocks) to message history
      messages.push({ role: "assistant", content: response.content });

      // tool_results will collect all results to send back in one message
      const toolResults = [];

      // Loop through all tool calls in this response
      // Claude can call multiple tools in one response
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        console.log(`🔧 Tool called: ${block.name}`);
        console.log(`   Input: ${JSON.stringify(block.input, null, 2)}`);

        let result;
        try {
          // Execute the actual tool (LI.FI API call, save config, etc.)
          result = await executeTool(block.name, block.input);
          console.log(`   Result: ${JSON.stringify(result, null, 2)}`);
        } catch (err) {
          // If tool fails, tell Claude so it can decide what to do next
          result = { error: err.message };
          console.log(`   ❌ Tool error: ${err.message}`);
        }

        // Collect this tool result — must match the tool_use block's id
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result)
        });
      }

      // Feed all tool results back to Claude in one user message
      messages.push({ role: "user", content: toolResults });

      // Loop back — Claude will now reason on the tool results
    }
  }
}

// ─────────────────────────────────────────────────────────────
// startAutonomousLoop()
// Reads the config and schedules the agent to run every
// interval_minutes using node-cron.
// node-cron uses cron syntax — "*/5 * * * *" means "every 5 minutes"
// ─────────────────────────────────────────────────────────────
async function startAutonomousLoop(config) {
  const address = getWalletAddress();
  const balance = await getETHBalance();

  console.log(`\n🚀 Starting DCA agent`);
  console.log(`   Wallet: ${address}`);
  console.log(`   Balance: ${balance} ETH`);
  console.log(`   Rule: ${config.instruction}`);
  console.log(`   Interval: every ${config.interval_minutes} minutes\n`);

  // Build the autonomous message Claude receives on each iteration
  // This gives Claude full context to make a decision
  const loopMessage = `
Run the DCA rule now.
Config: ${JSON.stringify(config)}
Wallet address: ${address}
Current ETH balance: ${balance} ETH
Execute the swap as configured. Get a quote first, then execute if it looks reasonable.
  `.trim();

  // Run once immediately so you don't wait the full interval on first start
  await runAgentLoop(loopMessage);

  // Convert minutes to cron syntax: "*/N * * * *" = every N minutes
  const cronExpression = `*/${config.interval_minutes} * * * *`;

  // Schedule recurring runs
  cron.schedule(cronExpression, async () => {
    const currentBalance = await getETHBalance();
    const updatedMessage = loopMessage.replace(
      /Current ETH balance: .* ETH/,
      `Current ETH balance: ${currentBalance} ETH`
    );
    await runAgentLoop(updatedMessage);
  });

  console.log(`⏰ Scheduled: running every ${config.interval_minutes} minutes`);
}

// ─────────────────────────────────────────────────────────────
// main()
// Entry point — detects which mode to run based on CLI arguments
// process.argv[2] is the first argument after "node agent.js"
// ─────────────────────────────────────────────────────────────
async function main() {
  const instruction = process.argv[2];

  if (instruction) {
    // CONFIGURE mode — user passed an instruction as argument
    console.log(`\n📋 Configure mode: "${instruction}"`);
    await runAgentLoop(
      `Parse this DCA instruction and call save_config with the correct parameters: "${instruction}"`
    );
    console.log(`\n✅ Config saved. Run "node agent.js" to start the loop.\n`);

  } else {
    // RUN mode — load existing config and start the loop
    const config = loadConfig();

    if (!config) {
      console.log(`\n❌ No config found. First set a rule:`);
      console.log(`   node agent.js "swap 0.001 ETH to USDC every 3 minutes"\n`);
      process.exit(1);
    }

    await startAutonomousLoop(config);
  }
}

main().catch(err => {
  console.error(`\n💥 Fatal error: ${err.message}`);
  process.exit(1);
});
