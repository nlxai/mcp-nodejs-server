# MCP NLX Node.js Server

## Project Description

This project is a Node.js server implementation for the Model Context Protocol (MCP) using the NLX framework. It provides a server that can handle tool requests and communicate with an NLX application via API calls.

## Setup

### Prerequisites

- Node.js (version 14 or later)
- npm (Node Package Manager)

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   ```
2. Navigate to the project directory:
   ```bash
   cd nlx-mcp-server
   ```
3. Install the dependencies:
   ```bash
   npm install
   ```

## Usage

### Environment Variables

- `NLX_APP_URL`: The base URL of your NLX application.
- `NLX_API_KEY`: The API key for authenticating requests to your NLX application.

### Running the Server

To start the server, run the following command:

```bash
node src/index.ts
```

The server will start and listen for requests via standard input/output.

## Troubleshooting

### Common Issues

- **Module Not Found Errors**: Ensure that all dependencies are correctly installed and that the paths in the import statements are correct.
- **Environment Variables**: Make sure that `NLX_APP_URL` and `NLX_API_KEY` are set correctly in your environment.

### Linter Errors

- **Cannot find module**: Verify that the module paths are correct and that the modules are installed.
- **Implicit 'any' type**: Consider adding TypeScript type definitions to avoid implicit 'any' types.
