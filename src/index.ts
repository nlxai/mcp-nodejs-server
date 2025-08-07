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
async function handleStreamingResponse(
  response: Response, 
  sendNotification?: (notification: any) => Promise<void>,
  progressToken?: string | number
) {
  if (!response.body) {
    throw new Error("No response body for streaming");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: any = null;
  let eventCount = 0;

  try {
    // Send initial notification that streaming started
    if (sendNotification) {
      await sendNotification({
        method: "notifications/message",
        params: {
          level: "info",
          data: {
            type: "stream_start",
            message: "Starting to process streaming response",
            timestamp: new Date().toISOString()
          }
        }
      });
    }

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
          eventCount++;
          
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

              // Determine notification type based on event type
              if (event.event === "progress" && progressToken) {
                // Send progress notification if we have a progress token
                await sendNotification({
                  method: "notifications/progress",
                  params: {
                    progressToken,
                    progress: parsedData.progress || eventCount,
                    total: parsedData.total,
                    message: parsedData.message || `Event ${eventCount}`
                  }
                });
              } else if (event.event === "error") {
                // Send error notification
                await sendNotification({
                  method: "notifications/message",
                  params: {
                    level: "error",
                    data: {
                      type: "stream_error",
                      error: parsedData,
                      timestamp: new Date().toISOString()
                    }
                  }
                });
              } else {
                // Send general message notification
                await sendNotification({
                  method: "notifications/message",
                  params: {
                    level: "info",
                    data: {
                      type: "stream_data",
                      eventType: event.event || "data",
                      content: parsedData,
                      eventId: event.id,
                      timestamp: new Date().toISOString()
                    }
                  }
                });
              }
            } catch (notificationError) {
              console.error("Error sending notification:", notificationError);
              // Send error notification about the notification failure
              if (sendNotification) {
                try {
                  await sendNotification({
                    method: "notifications/message",
                    params: {
                      level: "warning",
                      data: {
                        type: "notification_error",
                        error: "Failed to parse streaming event",
                        rawEvent: event.data,
                        timestamp: new Date().toISOString()
                      }
                    }
                  });
                } catch {
                  // If we can't even send the error notification, just log it
                  console.error("Failed to send error notification");
                }
              }
            }
          }

          // Check if this is the final result
          if (event.event === "done" || event.event === "complete" || event.event === "end") {
            try {
              finalResult = event.data ? JSON.parse(event.data) : null;
            } catch {
              finalResult = { content: [{ type: "text", text: event.data || "Stream completed" }] };
            }
          }
        }
      }
    }

    // Send completion notification
    if (sendNotification) {
      await sendNotification({
        method: "notifications/message",
        params: {
          level: "info",
          data: {
            type: "stream_complete",
            message: `Stream completed successfully. Processed ${eventCount} events.`,
            eventCount,
            timestamp: new Date().toISOString()
          }
        }
      });
    }

    // Return final result or default success response
    return finalResult || {
      content: [{ type: "text", text: `Stream completed successfully. Processed ${eventCount} events.` }]
    };

  } catch (error) {
    // Send error notification if possible
    if (sendNotification) {
      try {
        await sendNotification({
          method: "notifications/message",
          params: {
            level: "error",
            data: {
              type: "stream_error",
              error: error instanceof Error ? error.message : String(error),
              timestamp: new Date().toISOString()
            }
          }
        });
      } catch {
        console.error("Failed to send error notification");
      }
    }
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
        tools: {},
        notifications: {
          message: true,
          progress: true
        }
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
      const { name, arguments: args, _meta } = request.params;
      const appUrl = `${NLX_APP_URL}/tools/${name}`;
      const progressToken = _meta?.progressToken;
      
      // Add Accept header to request SSE streaming if supported
      const response = await fetch(appUrl, {
        method: "POST",
        headers: {
          "nlx-api-key": NLX_API_KEY,
          "Accept": "text/event-stream, application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ ...args, _meta })
      });

      if (!response.ok) {
        // Send error notification if we have sendNotification available
        if (extra?.sendNotification) {
          try {
            await extra.sendNotification({
              method: "notifications/message",
              params: {
                level: "error",
                data: {
                  type: "http_error",
                  status: response.status,
                  statusText: response.statusText,
                  url: appUrl,
                  timestamp: new Date().toISOString()
                }
              }
            });
          } catch {
            // Ignore notification errors
          }
        }
        throw new Error(`Response status: ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      
      // Check if response is SSE stream
      if (contentType.includes("text/event-stream")) {
        return await handleStreamingResponse(response, extra?.sendNotification, progressToken);
      } else {
        // Handle regular JSON response
        const json = await response.json();
        if (!json) {
          throw new Error(
            `NLX MCP request failed. Please check you have a valid application URL and API key`
          );
        }
        
        // Send notification for successful non-streaming response
        if (extra?.sendNotification) {
          try {
            await extra.sendNotification({
              method: "notifications/message",
              params: {
                level: "info",
                data: {
                  type: "tool_complete",
                  toolName: name,
                  message: "Tool executed successfully (non-streaming)",
                  timestamp: new Date().toISOString()
                }
              }
            });
          } catch {
            // Ignore notification errors
          }
        }
        
        return json;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Send error notification if available
      if (extra?.sendNotification) {
        try {
          await extra.sendNotification({
            method: "notifications/message",
            params: {
              level: "error",
              data: {
                type: "tool_error",
                error: errorMessage,
                timestamp: new Date().toISOString()
              }
            }
          });
        } catch {
          // Ignore notification errors
        }
      }
      
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
