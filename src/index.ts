#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

const NLX_APP_URL = process.env.NLX_APP_URL || "";
const NLX_API_KEY = process.env.NLX_API_KEY || "";

// Handle streaming SSE response from NLX API
async function handleStreamingResponse(response: Response, sendNotification?: (notification: any) => Promise<void>) {
  if (!response.body) {
    throw new Error("No response body for streaming");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: any = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        break;
      }

      // Decode the chunk and add to buffer
      buffer += decoder.decode(value, { stream: true });
      
      // Process complete SSE events
      const events = buffer.split('\n\n');
      buffer = events.pop() || ""; // Keep incomplete event in buffer
      
      for (const eventData of events) {
        if (eventData.trim() === "") continue;
        
        const event = parseSSEEvent(eventData);
        if (event) {
          // Send streaming data as MCP notification
          if (sendNotification && event.data) {
            try {
              // Try to parse as JSON first
              let parsedData;
              try {
                parsedData = JSON.parse(event.data);
              } catch {
                // If not JSON, send as text
                parsedData = event.data;
              }

              await sendNotification({
                method: "notifications/message",
                params: {
                  level: "info",
                  data: parsedData
                }
              });
            } catch (notificationError) {
              console.error("Error sending notification:", notificationError);
            }
          }

          // Check if this is the final result
          if (event.event === "done" || event.event === "complete") {
            try {
              finalResult = event.data ? JSON.parse(event.data) : null;
            } catch {
              finalResult = { content: [{ type: "text", text: event.data || "Stream completed" }] };
            }
          }
        }
      }
    }

    // Return final result or default success response
    return finalResult || {
      content: [{ type: "text", text: "Stream completed successfully" }]
    };

  } catch (error) {
    throw new Error(`Streaming error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    reader.releaseLock();
  }
}

// Parse individual SSE event
function parseSSEEvent(eventData: string) {
  const lines = eventData.split('\n');
  const event: { event?: string; data?: string; id?: string } = {};

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    
    const field = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    
    switch (field) {
      case 'event':
        event.event = value;
        break;
      case 'data':
        event.data = (event.data || "") + value;
        break;
      case 'id':
        event.id = value;
        break;
    }
  }
  
  return event.data ? event : null;
}

try {
  // Server setup
  const server = new Server(
    {
      name: "nlx-mcp-nodejs-server",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

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
      throw new Error(
        `NLX MCP request failed. Please check you have a valid application URL and API key`
      );
    }

    return json;
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    // call a specific tool (powered by an NLX flow) given the application URL, a tool name, and parameters
    try {
      const { name, arguments: args } = request.params;
      const appUrl = `${NLX_APP_URL}/tools/${name}`;
      
      // Add Accept header to request SSE streaming if supported
      const response = await fetch(appUrl, {
        method: "POST",
        headers: {
          "nlx-api-key": NLX_API_KEY,
          "Accept": "text/event-stream, application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ ...args })
      });

      if (!response.ok) {
        throw new Error(`Response status: ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      
      // Check if response is SSE stream
      if (contentType.includes("text/event-stream")) {
        return await handleStreamingResponse(response, extra?.sendNotification);
      } else {
        // Handle regular JSON response
        const json = await response.json();
        if (!json) {
          throw new Error(
            `NLX MCP request failed. Please check you have a valid application URL and API key`
          );
        }
        return json;
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${errorMessage}` }],
        isError: true
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
} catch (error) {
  console.error("Fatal error running server:", error);
  process.exit(1);
}
