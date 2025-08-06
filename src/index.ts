#!/usr/bin/env node

import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";

const NLX_APP_URL = process.env.NLX_APP_URL || "";
const NLX_API_KEY = process.env.NLX_API_KEY || "";
const PORT = parseInt(process.env.PORT || '3001', 10);

console.error(`Environment check - NLX_APP_URL: ${NLX_APP_URL ? NLX_APP_URL : 'NOT SET'}`);
console.error(`Environment check - NLX_API_KEY: ${NLX_API_KEY ? 'SET (length: ' + NLX_API_KEY.length + ')' : 'NOT SET'}`);

// Session storage for managing multiple clients
const sessions = new Map<string, { server: Server; transport: StreamableHTTPServerTransport }>();

// Helper function to stream SSE responses through MCP
async function streamSSEResponse(response: Response, res: express.Response, sessionId: string, requestId: any): Promise<void> {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  
  if (!reader) {
    throw new Error('Response body is not readable');
  }

  let buffer = '';
  let isFirstChunk = true;
  
  // Set up SSE response headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Mcp-Session-Id': sessionId
  });

  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        // Send completion event
        const completionEvent = {
          jsonrpc: "2.0",
          id: requestId,
          result: {
            content: [{ type: "text", text: "[STREAM_COMPLETE]" }]
          }
        };
        res.write(`data: ${JSON.stringify(completionEvent)}\n\n`);
        res.end();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = line.slice(6);
            
            if (data === '[DONE]') {
              const completionEvent = {
                jsonrpc: "2.0",
                id: requestId,
                result: {
                  content: [{ type: "text", text: "[STREAM_COMPLETE]" }]
                }
              };
              res.write(`data: ${JSON.stringify(completionEvent)}\n\n`);
              res.end();
              return;
            }
            
            if (data.trim()) {
              const parsed = JSON.parse(data);
              
              // Extract content from the NLX response
              let textContent = '';
              if (typeof parsed === 'string') {
                textContent = parsed;
              } else if (parsed.content) {
                textContent = parsed.content;
              } else if (parsed.text) {
                textContent = parsed.text;
              } else if (parsed.delta) {
                textContent = parsed.delta;
              } else if (parsed.choices && parsed.choices[0]?.delta?.content) {
                textContent = parsed.choices[0].delta.content;
              } else if (parsed.result && parsed.result.content && parsed.result.content.text) {
                textContent = parsed.result.content.text;
              } else {
                textContent = JSON.stringify(parsed);
              }
              
              // Send each chunk as an MCP response
              const chunkResponse = {
                jsonrpc: "2.0",
                id: requestId,
                result: {
                  content: [{ 
                    type: "text", 
                    text: textContent,
                    metadata: {
                      streaming: true,
                      isComplete: false
                    }
                  }]
                }
              };
              
              console.error(`Streaming chunk: ${textContent.substring(0, 100)}...`);
              res.write(`data: ${JSON.stringify(chunkResponse)}\n\n`);
            }
          } catch (parseError) {
            console.error('Error parsing SSE data:', parseError);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Helper function to fetch tools from NLX API
async function fetchNLXTools(): Promise<any> {
  if (!NLX_APP_URL || !NLX_API_KEY) {
    console.error('Missing NLX credentials');
    return { tools: [] };
  }

  console.error(`Fetching tools from: ${NLX_APP_URL}/tools`);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  
  try {
    const response = await fetch(`${NLX_APP_URL}/tools`, {
      headers: {
        "nlx-api-key": NLX_API_KEY,
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    console.error(`Tools response status: ${response.status}`);
    
    if (!response.ok) {
      console.error(`Tools request failed: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error(`Error response body: ${errorText}`);
      return { tools: [] };
    }
    
    const responseText = await response.text();
    console.error(`Raw tools response: ${responseText}`);
    
    const json = JSON.parse(responseText);
    console.error(`Parsed tools response:`, json);
    return json || { tools: [] };
    
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('Tools request timed out after 10 seconds');
    } else {
      console.error('Error fetching tools:', error);
    }
    return { tools: [] };
  }
}

// Helper function to call NLX tool (fallback for non-streaming cases)
async function callNLXTool(name: string, args: any): Promise<any> {
  if (!NLX_APP_URL || !NLX_API_KEY) {
    return {
      content: [{ type: "text", text: "Server not configured properly" }],
      isError: true
    };
  }

  console.error(`Executing tool: ${name}`);
  
  try {
    const response = await fetch(`${NLX_APP_URL}/tools/${name}`, {
      method: "POST",
      headers: {
        "nlx-api-key": NLX_API_KEY,
        "Accept": "application/json", // Request JSON instead of SSE for this function
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args || {})
    });

    if (!response.ok) {
      return {
        content: [{ type: "text", text: `Tool execution failed: ${response.status}` }],
        isError: true
      };
    }

    // Handle JSON response only
    const json = await response.json();
    return json || {
      content: [{ type: "text", text: `${name} completed successfully.` }]
    };
    
  } catch (error) {
    console.error(`Tool execution error:`, error);
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true
    };
  }
}

// Create Express app
const app = express();
app.use(express.json({ limit: '10mb' }));

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id, Last-Event-Id');
  res.header('Access-Control-Expose-Headers', 'Content-Type, Mcp-Session-Id');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// Function to create a new MCP server instance
function createMCPServer(): Server {
  const server = new Server(
    {
      name: "nlx-mcp-server",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Tool listing handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return await fetchNLXTools();
  });

  // Tool call handler with SSE streaming support
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return await callNLXTool(name, args);
  });

  return server;
}

// Main MCP endpoint
app.all('/mcp', async (req, res) => {
  console.error(`Received ${req.method} request to /mcp`);
  console.error(`Headers:`, req.headers);
  console.error(`Body:`, req.body);
  
  try {
    let sessionId = req.headers['mcp-session-id'] as string;
    
    if (req.method === 'DELETE') {
      // Terminate session
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        session?.transport.close?.();
        sessions.delete(sessionId);
        console.error(`Session ${sessionId} terminated`);
      }
      res.status(204).send();
      return;
    }

    if (req.method === 'GET') {
      // SSE connection for existing session
      if (!sessionId || !sessions.has(sessionId)) {
        console.error(`GET request - Invalid session ID: ${sessionId}`);
        res.status(400).json({ error: 'Invalid session ID' });
        return;
      }

      console.error(`Starting SSE connection for session: ${sessionId}`);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Mcp-Session-Id': sessionId
      });

      // Keep connection alive
      const keepAlive = setInterval(() => {
        res.write(': keepalive\n\n');
      }, 30000);

      req.on('close', () => {
        clearInterval(keepAlive);
        console.error(`SSE connection closed for session ${sessionId}`);
      });

      return;
    }

    if (req.method === 'POST') {
      console.error(`POST request with session ID: ${sessionId}`);
      
      // Handle MCP requests
      if (!sessionId) {
        // Create new session for initialize request
        sessionId = randomUUID();
        console.error(`Creating new session: ${sessionId}`);
        
        const server = createMCPServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId
        });

        await server.connect(transport);
        sessions.set(sessionId, { server, transport });
        console.error(`Session ${sessionId} created and stored`);
        
        res.setHeader('Mcp-Session-Id', sessionId);
      }

      const session = sessions.get(sessionId);
      if (!session) {
        console.error(`Session not found: ${sessionId}`);
        res.status(400).json({ error: 'Session not found' });
        return;
      }

      // Handle MCP protocol requests
      if (req.body && req.body.method) {
        console.error(`Handling MCP method: ${req.body.method}`);
        
        let response: any;
        
        switch (req.body.method) {
          case 'initialize':
            console.error(`Handling initialize request`);
            response = {
              jsonrpc: "2.0",
              id: req.body.id,
              result: {
                protocolVersion: "2025-06-18",
                capabilities: {
                  tools: {},
                  resources: {},
                  prompts: {}
                },
                serverInfo: {
                  name: "nlx-mcp-server",
                  version: "0.1.0"
                }
              }
            };
            break;
            
          case 'tools/list':
            console.error(`Handling tools/list request`);
            const toolsData = await fetchNLXTools();
            response = {
              jsonrpc: "2.0",
              id: req.body.id,
              result: toolsData
            };
            break;
            
          case 'resources/list':
            console.error(`Handling resources/list request`);
            response = {
              jsonrpc: "2.0",
              id: req.body.id,
              result: { resources: [] }
            };
            break;
            
          case 'prompts/list':
            console.error(`Handling prompts/list request`);
            response = {
              jsonrpc: "2.0",
              id: req.body.id,
              result: { prompts: [] }
            };
            break;
            
          case 'tools/call':
            console.error(`Handling tools/call request`);
            const { name, arguments: args } = req.body.params;
            
            if (!NLX_APP_URL || !NLX_API_KEY) {
              response = {
                jsonrpc: "2.0",
                id: req.body.id,
                result: {
                  content: [{ type: "text", text: "Server not configured properly" }],
                  isError: true
                }
              };
            } else {
              try {
                console.error(`Executing tool: ${name}`);
                
                const toolResponse = await fetch(`${NLX_APP_URL}/tools/${name}`, {
                  method: "POST",
                  headers: {
                    "nlx-api-key": NLX_API_KEY,
                    "Accept": "text/event-stream",
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(args || {})
                });

                if (!toolResponse.ok) {
                  response = {
                    jsonrpc: "2.0",
                    id: req.body.id,
                    result: {
                      content: [{ type: "text", text: `Tool execution failed: ${toolResponse.status}` }],
                      isError: true
                    }
                  };
                } else {
                  // Check if streaming response
                  const contentType = toolResponse.headers.get('content-type');
                  if (contentType && contentType.includes('text/event-stream')) {
                    console.error(`Starting real-time SSE streaming for tool: ${name}`);
                    
                    // Stream the response in real-time
                    await streamSSEResponse(toolResponse, res, sessionId, req.body.id);
                    return; // Don't send additional response
                    
                  } else {
                    // Non-streaming response
                    const json = await toolResponse.json();
                    response = {
                      jsonrpc: "2.0",
                      id: req.body.id,
                      result: json || {
                        content: [{ type: "text", text: `${name} completed successfully.` }]
                      }
                    };
                  }
                }
              } catch (error) {
                console.error(`Tool execution error:`, error);
                response = {
                  jsonrpc: "2.0",
                  id: req.body.id,
                  result: {
                    content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
                    isError: true
                  }
                };
              }
            }
            break;
            
          case 'notifications/cancelled':
            console.error(`Handling cancellation notification`);
            res.status(200).send();
            return;
            
          case 'notifications/initialized':
            console.error(`Handling notifications/initialized`);
            res.status(200).send();
            return;
            
          default:
            console.error(`Unknown method: ${req.body.method}`);
            response = {
              jsonrpc: "2.0",
              id: req.body.id,
              error: {
                code: -32601,
                message: `Method not found: ${req.body.method}`
              }
            };
        }

        console.error(`Sending response:`, JSON.stringify(response, null, 2));
        res.setHeader('Mcp-Session-Id', sessionId);
        res.json(response);
        return;
      }
    }
  } catch (error) {
    console.error('MCP endpoint error:', error);
    res.status(500).json({ 
      jsonrpc: "2.0",
      id: req.body?.id || null,
      error: { 
        code: -32603,
        message: 'Internal server error',
        data: error instanceof Error ? error.message : String(error)
      }
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', sessions: sessions.size });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.error(`NLX MCP Server with SSE support running on port ${PORT}`);
  console.error(`Endpoint: http://localhost:${PORT}/mcp`);
  console.error(`Use with mcp-remote: npx -y mcp-remote http://localhost:${PORT}/mcp`);
  console.error(`Server is ready for connections...`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.error('Received SIGTERM, shutting down gracefully...');
  sessions.forEach((session, sessionId) => {
    session.transport.close?.();
    sessions.delete(sessionId);
  });
  process.exit(0);
});

process.on('SIGINT', () => {
  console.error('Received SIGINT, shutting down gracefully...');
  sessions.forEach((session, sessionId) => {
    session.transport.close?.();
    sessions.delete(sessionId);
  });
  process.exit(0);
});