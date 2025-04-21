# MCP NLX Node.js Server

## Project Description

This project is a Node.js server implementation for the Model Context Protocol (MCP) using the NLX framework. It provides a server that can handle tool requests and communicate with an NLX application via API calls.

## Configuration

### Claude Desktop

1. Open your Claude Desktop configuration:

   ```
   open ~/Library/Application\ Support/Claude/claude_desktop_config.json
   ```

2. Add the NLX Application configuration:
   ```json
   {
     "mcpServers": {
       "nlx": {
         "command": "npx",
         "args": ["-y", "@nlxai/mcp-nodejs-server"],
         "env": {
           "NLX_API_KEY": "",
           "NLX_APP_URL": ""
         }
       }
     }
   }
   ```

## Setup

### Prerequisites

- Node.js (version 18 or later)
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
npm run start
```

The server will start and listen for requests via standard input/output.

## Troubleshooting

### Common Issues

- **Module Not Found Errors**: Ensure that all dependencies are correctly installed and that the paths in the import statements are correct.
- **Environment Variables**: Make sure that `NLX_APP_URL` and `NLX_API_KEY` are set correctly in your environment.

### Linter Errors

- **Cannot find module**: Verify that the module paths are correct and that the modules are installed.
- **Implicit 'any' type**: Consider adding TypeScript type definitions to avoid implicit 'any' types.

## Release Management

### Automated Releases with Semantic Release

This project uses [semantic-release](https://semantic-release.gitbook.io/semantic-release/) to automate the versioning and release process. Semantic Release ensures that the version number and changelog are automatically updated based on the commit messages.

#### Commit Message Format

Semantic Release uses the Angular commit message conventions. Here is a brief overview of the format:

- **feat**: A new feature
- **fix**: A bug fix
- **docs**: Documentation only changes
- **style**: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
- **refactor**: A code change that neither fixes a bug nor adds a feature
- **perf**: A code change that improves performance
- **test**: Adding missing or correcting existing tests
- **chore**: Changes to the build process or auxiliary tools and libraries such as documentation generation

#### How to Release

To create a new release, simply push your changes to the `main` branch. The CI/CD pipeline will automatically run semantic-release to determine the next version number, update the changelog, and publish the release.

Ensure your commit messages follow the Angular conventions to trigger the correct version updates.

In dire cicd situations, you can manually trigger a release by running the following command:

```bash
npx semantic-release --no-ci
```
