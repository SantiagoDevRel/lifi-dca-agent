const toolDefs = [
    {
      name: "get_quote",
      description: "Get the best swap/bridge quote from LI.FI for a given token pair and amount. Call this before any execution to know the expected output and fees.",
      input_schema: {
        type: "object",
        properties: {
          fromChain: {
            type: "string",
            description: "Source chain ID as string, e.g. '84532' for Base Sepolia"
          },
          toChain: {
            type: "string",
            description: "Destination chain ID as string, e.g. '84532' for Base Sepolia"
          },
          fromToken: {
            type: "string",
            description: "Token symbol to swap from, e.g. 'ETH' or 'USDC'"
          },
          toToken: {
            type: "string",
            description: "Token symbol to swap to, e.g. 'ETH' or 'USDC'"
          },
          fromAmount: {
            type: "string",
            description: "Amount in smallest unit (wei). For 0.001 ETH use '1000000000000000'"
          },
          fromAddress: {
            type: "string",
            description: "Sender wallet address"
          }
        },
        required: ["fromChain", "toChain", "fromToken", "toToken", "fromAmount", "fromAddress"]
      }
    },
    {
      name: "get_status",
      description: "Check the status of a cross-chain transfer using its transaction hash.",
      input_schema: {
        type: "object",
        properties: {
          txHash: {
            type: "string",
            description: "Transaction hash from the source chain"
          },
          fromChain: {
            type: "string",
            description: "Source chain ID as string"
          },
          toChain: {
            type: "string",
            description: "Destination chain ID as string"
          }
        },
        required: ["txHash"]
      }
    },
    {
      name: "save_config",
      description: "Save the DCA rule parsed from the user's natural language instruction. Call this when the user gives a new instruction like 'swap every 5 minutes'.",
      input_schema: {
        type: "object",
        properties: {
          instruction: {
            type: "string",
            description: "The original natural language instruction from the user"
          },
          interval_minutes: {
            type: "number",
            description: "How often to execute the swap, in minutes"
          },
          from_token: {
            type: "string",
            description: "Token to swap from, e.g. 'ETH'"
          },
          to_token: {
            type: "string",
            description: "Token to swap to, e.g. 'USDC'"
          },
          amount_wei: {
            type: "string",
            description: "Amount to swap in wei (smallest unit). For 0.001 ETH use '1000000000000000'"
          }
        },
        required: ["instruction", "interval_minutes", "from_token", "to_token", "amount_wei"]
      }
    },
    {
      name: "execute_swap",
      description: "Execute the actual swap transaction on-chain using the transaction data from a quote. Only call this after get_quote has returned valid transaction data.",
      input_schema: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description: "Contract address to send the transaction to"
          },
          data: {
            type: "string",
            description: "Encoded transaction data (calldata) from the quote"
          },
          value: {
            type: "string",
            description: "ETH value to send with the transaction in wei"
          },
          gasLimit: {
            type: "string",
            description: "Gas limit for the transaction"
          }
        },
        required: ["to", "data", "value"]
      }
    }
  ];
  
  module.exports = toolDefs;