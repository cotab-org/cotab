# Cotab

[English](README.md) | [日本語](README.ja.md) | [中文](README.zh-cn.md)

This VS Code extension is an AI-powered multi-line autocomplete plugin designed with maximum privacy and security in mind by running entirely on a local LLM.

In addition to the entire file's context, it also considers external symbols, errors, and prior edits, and uses AI to generate multiple lines of code that are presented as autocomplete suggestions. In particular, when using Qwen3-Coder-30B-A3B, you can get high-quality completion comparable to cloud services.
**Setup can be completed with a single click and is ready to use immediately.** Also, you can switch the model to use with a single click, and Qwen3-Coder-30B-A3B can run on VRAM 4GB or 8GB environments.

It also offers a dedicated translation-only mode.

## Autocomplete
![Autocomplete Demo](doc/asset/cotab-tutorial-autocomplete1.gif)
The programming languages supported depend on the AI model. Despite its compact size, the default model Qwen3-4B-Instruct-2507 supports many languages.
Qwen3-Coder-30B-A3B supports even more languages and, like magic, suggests exactly the code you're about to type. 

## Auto Comment Mode
![Comment Demo](doc/github-asset/cotab-demo-comment.gif)
A dedicated mode that adds code comments. It analyzes code more deeply than the normal mode, understands the intent of the algorithm, and automatically adds detailed comments.
Qwen3-4B-Instruct-2507 already delivers good comments, but this use case can tolerate a slowdown, so we recommend Qwen3-Coder-30B-A3B for the best results.

## Auto Translate Mode
![Translate Demo](doc/github-asset/cotab-demo-translate.gif)
A translation-only mode. It can translate not only code comments but also regular text files.
Qwen3-4B-Instruct-2507 also delivers high-quality translations, but in this use case, it is recommended to use Qwen3-Coder-30B-A3B for the best results, as performance degradation is tolerable.

## Feature
- Prioritizes privacy, operates completely offline using local LLM
- Provides functionality focused solely on inline suggestions
- Suggests not only inline completion from cursor position, but also multi-line edits
- Provides suggestions considering the entire content of target files, symbols from other files, and edit history
- Offers fast response optimized for llama-server
- There are also modes for Auto Comment and Auto Translate.
- Open source ensuring transparency

## Getting started
1. Install Cotab via the VS Code marketplace
   ![Getting started - install](doc/github-asset/cotab-demo-install.gif)
  
2. Click "Install Local Server" button or configure your api.
   ![Getting started - setup](doc/github-asset/cotab-demo-setup.gif)
   Note:
   - It may take a while the first time because it downloads a 2.5GB model.
   - The server starts automatically after installation.
   - Installation Supported Platforms Windows/MacOS/Ubuntu
  
3. Start typing!
   ![Getting started - completion](doc/github-asset/cotab-demo-completion.gif)
   
   |Command|Keybinding|
   | ---- | ---- |
   |Accept All|Tab|
   |Accept First line|Shift + Tab|
   |Reject|Esc|

   Note:
   - By rejecting, you can change the next completion candidates.
   - Italic display overlay means the AI is still outputting the result and the result has not been determined yet. In most cases, it is the same as the final result, but in the case of italic display, there may be problems with the merge result.

## Important Notes
- Requests generally involve prompts exceeding 10,000 tokens.
- Optimized for llama-server; we strongly recommend using llama-server
- **Be especially careful when using pay-per-use API servers, as token consumption can be rapid**
- When using a local server, **we strongly recommend single-user usage**

  A local server is optimized for **single-user**.
  Concurrent use by multiple users will significantly penalize inference and severely degrade response speed

## Tips for use

- Comment First

  The default model (Qwen3-4B-Instruct-2507) is compact yet highly capable, though it is not specifically designed for code completion. Unlike many recent cloud services, it may not immediately suggest the exact code you want to write. In such cases, writing a comment that describes the code you want first will help the model generate more precise code suggestions based on your description.
  ![comment first](doc/github-asset/cotab-demo-comment-first.gif)
  
- Edit Prompt

  While model quality matters, completion accuracy varies greatly depending on the prompt content. By customizing the prompt, you may be able to further improve accuracy.

  Also, you can create your own custom mode.
  
  To edit the prompt, open it from the menu. The default prompt is commented out. Uncomment it, edit and save, and changes will be immediately reflected in completions.
  ![open prompt](doc/github-asset/cotab-demo-open-prompt.gif)

## Performance
- **Recommend:** GeForce RTX 3000 series or later GPU (or equivalent) for optimal performance.

- Cotab is optimized for llama-server and Qwen3-4B-Instruct-2507 and is designed for high-speed operation. In practical environments with source code over 1,000 lines containing hundreds of external reference symbols, the prompt exceeds 15,000 tokens. Even in such situations, it understands the entire context and shows completions from the second request onward in about 0.5 seconds on a GeForce RTX 4070.

- AI processing shows significant performance improvements with the GeForce RTX 3000 series and later. For comfortable response, we recommend a GeForce RTX 3000 series or later GPU or equivalent.

## Details
- llama-server

  You can also use OpenAI compatible APIs, but we strongly recommend using llama-server. llama-server has low overhead and operates at the fastest speed among servers using llama.cpp as backend.
  Code completion frequently repeat requests and cancellations, so that overhead directly affects user experience. When using llama-server, always specify "-np 1".
  
- Prompt Optimization

  llama-server has a mechanism enabled by default that caches prompts from previous requests. Prompt cache is effective up to the part that matches the previous prompt, allowing prompt processing to be skipped up to that part.
  
  To make the most of this mechanism, the original source code  in prompt remains unchanged as users type. Instead, a minimal block of modified surrounding code is appended to the bottom of the prompt.

  Prompt is fully customizable, and you can switch between prepared modes with a single click.
  This allows you to perform completions with the optimal prompt for each purpose.
  
- Edit History

  Remembers the user's immediate previous edits and utilizes them in suggestions. Edits are categorized into add, delete, edit, rename, and copy to improve prediction accuracy.
  
  This makes functions created immediately before more likely to be suggested, more accurately reflecting user intent.
  
- Symbols from Other Files

  Uses symbols obtainable from VSCode's language providers and utilizes them in suggestions. These symbols allow LLM to understand class structures and improve the accuracy of member function suggestions.

  Note: Symbols are input in the order of files viewed in VS Code.

- Error Problems

  Uses diagnostic errors as input to generate code to fix errors.
  Even with a small AI model, it learns to correct errors, so the quality of proposals is further improved.
  
- Code Summary

  By summarizing the source code in advance and incorporating the results into the prompt, we enable a deeper level of understanding.
  This feature is disabled by default. Because the quality of completion is guaranteed even without summary, as the entire code is input.

- Progress Icon Description

  |Icon|Description|
  | ---- | ---- |
  |![spinner dot](doc/github-asset/readme-dot-spinner-0.png)|Analyzing source code|
  |![spinner red](doc/github-asset/readme-spinner-red-0.png)|Completing current line|
  |![spinner normal](doc/github-asset/readme-spinner-0.png)|Completing after current line|
  
## About Available Models
All text generation models are available, but powerful instruction-following performance is required for local code generation. (Instruction-following performance refers to the ability to strictly follow prompt rules and avoid rule violations.)

- Qwen3-Coder-30B-A3B

  80% of the model is allocated to code learning, providing high-quality completion comparable to cloud services. Furthermore, since the actual computation is equivalent to 3B, it operates at high speed like small models. This model can adjust VRAM usage without significantly degrading performance, so Cotab provides presets that work in 4GB or 8GB environments.

- Qwen3-4B-Instruct-2507

  Despite its very small size of 4B, it has outstanding instruction-following performance and high performance in fields such as mathematics, providing fast and high-quality completion in Cotab.

- Ministral-3-3B-Instruct-2512

  Despite its very small size of 3B, it has high performance and operates at high speed with VRAM 5GB usage. In Cotab, it provides fast and good quality completion.

- granite-4.0-micro

  It is not recommended because it often generates broken completions in Cotab.

- LFM2-2.6B

  It is designed to operate at more than twice the speed of Qwen3-4B-Instruct-2507 with only VRAM 3GB usage.
  It is not recommended because cases where code breaks have been observed in Cotab's code completion.
  However, it can be used when VRAM requirements are very strict or for translation purposes.

## Using Remote Servers
You can use OpenAI compatible API servers, but we strongly recommend using **llama-server** or **llama-swap**.
In particular, using **llama-server** through **llama-swap** allows automatic model switching when using other chat plugins.

- **Most Important**

  **When using llama-server, always specify the "-np 1" option.**
  In the late 2025 update of llama-server, it was changed to run with 4 parallel processes by default.
  Since Cotab frequently repeats requests and cancellations at high speed, they are mistaken for completely different requests, causing the prompt cache to not function and resulting in significant performance degradation.

## Privacy and Telemetry
- Cotab only communicates with the default endpoint `"http://localhost:8080/v1"` or the LLM API specified by the user. No other external services or servers are contacted. This ensures maximum privacy and security.
  - Communication is only made with the configured API
  - No telemetry or usage data is ever sent
  - User code or input is never shared with third parties
  - No personal information is collected or stored
  - This project is open-source, and all source code is available on GitHub

- With this policy, you can use Cotab with complete confidence.
- Note: If you install local server, it accesses the [llama.cpp github repository](https://github.com/ggml-org/llama.cpp/releases).

## Development / Contributions

- Contributions (issues, PRs, improvement proposals) are welcome.
- Bug fixes, optimizations, and sharing benchmark results are also welcome.

## How to build

- Setup requirements

  Please install VS Code in advance.

- Windows

  Run this single command to automatically download and execute the setup script. Nothing is required including Git or Node.js - all portable versions are automatically downloaded and set up in ./workspace, and the project will be cloned and VS Code will launch:
  
  ```bash
  mkdir cotab
  cd cotab
  powershell -NoProfile -Command "$f='run-vscode.bat'; (New-Object Net.WebClient).DownloadString('https://github.com/cotab-org/cotab/raw/refs/heads/main/run-vscode.bat') -replace \"`r?`n\",\"`r`n\" | Set-Content $f -Encoding ASCII; cmd /c $f"
  ```
  
  Press F5 in vscode to start debugging the plugin.
  
- Ubuntu

  Requires Node.js(v22).
    
  e.g., Install Node.js v22 via package manager.
  ```bash
  url -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
  ```
  
  Cotab clone & configure.
  
  ```bash
  git clone https://github.com/cotab-org/cotab.git
  cd cotab
  npm install
  code .\
  ```
  
  Press F5 in vscode to start debugging the plugin.
  
- MacOS

  Requires Node.js(v22).
  
  e.g., Install Node.js v22 on macos.
  ```bash
  # install nvm
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  
  # activate nvm
  \. "$HOME/.nvm/nvm.sh"
  
  # install node.js v22
  nvm install 22
  node -v
  ```
  
  Cotab clone & configure.
  
  ```bash
  git clone https://github.com/cotab-org/cotab.git
  cd cotab
  npm install
  code .\
  ```
  
  Press F5 in vscode to start debugging the plugin.

- Create Package

```bash
npx vsce package
```

## FAQ

### Why does the window flicker briefly when starting to use Cotab?
The brief window flicker occurs because Cotab calculates font size during initialization. VS Code doesn't provide a direct API to get character size, so Cotab uses a Webview to calculate the font size. This causes the brief flicker when starting to use Cotab.

## License
Copyright (c) 2025-2026 cotab
Apache License 2.0
