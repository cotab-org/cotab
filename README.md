# Cotab
This is a VS Code extension that provides AI-powered multi-line edit suggestions. It generates multiple lines of code using AI, taking into account not only the cursor position but also the all code context, and displays the merged result with the existing code as an autocomplete suggestion.

### Autocomplete
![Autocomplete Tutorial](doc/asset/cotab-tutorial-autocomplete1.gif)

### Auto Comment
![Autocomplete Tutorial](doc/asset/cotab-tutorial-autocomplete1.gif)

### Auto Translate
![Autocomplete Tutorial](doc/asset/cotab-tutorial-autocomplete1.gif)

The programming languages supported depend on the model you use; this extension itself is language-agnostic.

## Feature
- Provides functionality focused solely on inline suggestions
- Suggests not only inline completion from cursor position, but also multi-line edits
- Provides suggestions considering the entire content of target files, symbols from other files, and edit history
- Offers fast response optimized for llama-server
- There are also modes for Auto Comment and Auto Translate.
- Open source ensuring transparency
- Prioritizes privacy, operates completely offline using local LLM

## Getting started
1. Install Cotab via the VS Code marketplace
2. Click "Install Local Server" button or configure your api. (for mac: Configure your api.)
3. Start typing! - you'll see AI-powered multi-line suggestions appear
Note: It may take a while the first time because it downloads a 2.5GB model.

## Important Notes
- Requests generally involve prompts exceeding 10,000 tokens.
- Optimized for llama-server; we strongly recommend using llama-server
- **Be especially careful when using pay-per-use API servers, as token consumption can be rapid**
- When using a local server, **we strongly recommend single-user usage**
A local server is optimized for **single-user performance**.
Concurrent use by multiple users will significantly penalize inference and severely degrade response speed

## Performance
Cotab is optimized for llama-server and Qwen3-4b-2507 and is designed for high-speed operation. From the second request onward, even for source files over 1,000 lines, it understands the entire context and shows completions in about 0.6 seconds on an RTX 3070, even when the prompt exceeds 15,000 tokens and includes hundreds of reference symbols. After that, it continues to send completion requests on every keystroke and maintains that response time unless the cursor position changes significantly.

### Prompt
While model quality matters, completion accuracy varies greatly depending on the prompt content. By customizing the prompt, you may be able to further improve accuracy.

## Details
### llama-server
You can also use OpenAI compatible APIs, but strongly recommend using llama-server. llama-server has low overhead and operates at the fastest speed among servers using llama.cpp as backend.
Code completion frequently repeat requests and cancellations, so that overhead directly affects user experience.

### Prompt Optimization
llama-server has a mechanism enabled by default that caches prompts from previous requests. Prompt cache is effective up to the part that matches the previous prompt, allowing prompt processing to be skipped up to that part.

To make the most of this mechanism, the original source code  in prompt remains unchanged as users type. Instead, a minimal block of modified surrounding code is appended to the bottom of the prompt.

### Edit History
Remembers the user's immediate previous edits and utilizes them in suggestions. Edits are categorized into add, delete, edit, rename, and copy to improve prediction accuracy.

This makes functions created immediately before more likely to be suggested, more accurately reflecting user intent.

### Symbols from Other Files
Uses symbols obtainable from VSCode's language providers and utilizes them in suggestions. These symbols allow LLM to understand class structures and improve the accuracy of member function suggestions.

### Analysis source code
By analyzing the source code in advance and incorporating the results into the prompt, we enable a deeper level of understanding.

## Privacy and Telemetry
Cotab only communicates with the default endpoint `"http://localhost:8080/v1"` or the LLM API specified by the user. No other external services or servers are contacted. This ensures maximum privacy and security.
- Communication is only made with the configured API
- No telemetry or usage data is ever sent
- User code or input is never shared with third parties
- No personal information is collected or stored
- This project is open-source, and all source code is available on GitHub
- Note: When installing llama.cpp, it communicates with its repository.

With this policy, you can use Cotab with complete confidence.

## Development / Contributions

- Contributions (issues, PRs, improvement proposals) are welcome.
- Bug fixes, optimizations, and sharing benchmark results are also welcome.

## How to build

Please install VS Code in advance.

### Quick Start (Windows)

Run this single command to automatically download and execute the setup script. Nothing is required including Git or Node.js - all portable versions are automatically downloaded and set up in ./workspace, and the project will be cloned and VS Code will launch:

```bash
mkdir cotab
cd cotab
powershell -NoProfile -Command "$f='run-vscode.bat'; (New-Object Net.WebClient).DownloadString('https://github.com/cotab-org/cotab/raw/refs/heads/main/run-vscode.bat') -replace \"`r?`n\",\"`r`n\" | Set-Content $f -Encoding ASCII; cmd /c $f"
```

Press F5 in vscode to start debugging the plugin.

### Other Platforms

Requires VsCode, Node.js(v22) and Git.

e.g., Install Node.js v22 via ubuntu package manager.
```bash
url -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

clone & configure
```bash
git clone https://github.com/cotab-org/cotab.git
cd cotab
npm install
code .\
```

Press F5 in vscode to start debugging the plugin.

### Create Package

```bash
npx vsce package
```

## License
Copyright (c) 2025 cotab
Apache License 2.0
