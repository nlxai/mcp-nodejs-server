#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";

const NLX_APP_URL = process.env.NLX_APP_URL || "";
const NLX_API_KEY = process.env.NLX_API_KEY || "";

// Server setup
const server = new Server(
  {
    name: "nlx-mcp-nodejs-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);;

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const appUrl = `${NLX_APP_URL}/tools`;
  const response = await fetch(appUrl, {
  	headers: {
  		"nlx-api-key": NLX_API_KEY
  	}
  });

  if (!response.ok) {
    throw new Error(`Response status: ${response.status}`);
  }

  const json = await response.json();

  if (!json) {
    throw new Error(`NLX MCP request failed. Please check you have a valid application URL and API key`);
  }
  
  return json;
});


server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // call a specific tool (powered by an NLX flow) given the application URL, a tool name, and parameters
  try {
    const { name, arguments: args } = request.params;
    const appUrl = `${NLX_APP_URL}/tools/${name}`;
	  const response = await fetch(appUrl, 
	  	{
	  		method: "POST",
	  		headers: {
		  		"nlx-api-key": NLX_API_KEY
		  	},
	  		body: JSON.stringify({ ...args })
	  	});

	  if (!response.ok) {
	    throw new Error(`Response status: ${response.status}`);
	  }

	  const json = await response.json();

	  if (!json) {
	    throw new Error(`NLX MCP request failed. Please check you have a valid application URL and API key`);
	  }
	  
	  return json;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// Start server
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP NLX Server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});