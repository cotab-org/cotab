# Cotab
This is a VS Code extension that provides AI-powered multi-line edit suggestions. It generates multiple lines of code using AI, taking into account not only the cursor position but also the all code context, and displays the merged result with the existing code as an autocomplete suggestion.

## Feature
- Provides functionality focused solely on Autocomplete
- Suggests not only inline completion from cursor position, but also multi-line edits
- Provides suggestions considering the entire content of target files, symbols from other files, and edit history
- Offers fast response optimized for llama-server
- Open source ensuring transparency
- Prioritizes privacy, operates completely offline using local LLM

## Quick start
1. Install Cotab via the VS Code marketplace
2. Configure your local LLM server (e.g., llama-server) at `http://localhost:8080/v1`
3. Start typing in any file - you'll see AI-powered multi-line suggestions appear

## How to use


## Important Notes
- Prompts exceeding 10,000 tokens are always requested
- Optimized for llama-server, strongly recommend using llama-server
- **Please be especially careful when using pay-per-use API servers as they will consume tokens rapidly**
- When using a local server, **strongly recommend using it by only one person**
A single local server is optimized for **single-user use only** for high performance.
Simultaneous use by multiple people will cause significant penalties in inference processing, resulting in severely degraded response speed

## Performance
Cotab is optimized for llama-server and Qwen3-4b-2507, designed to operate at high speed. Even with source code exceeding 1000 lines, it understands the entire content and displays completions in about 0.6 seconds on RTX3070, even with prompts exceeding 15,000 tokens including hundreds of reference symbols. For the first time, it analyzes source code to improve accuracy. After that, as long as the cursor position doesn't move significantly, it sends completion requests with each keystroke even if exceeding 10,000 tokens, maintaining that response speed.

## Details
### llama-server
You can also use OpenAI compatible APIs, but strongly recommend using llama-server. llama-server has low overhead and operates at the fastest speed among servers using llama.cpp as backend.
Code completion requests frequently repeat requests and cancellations, so that overhead directly affects user experience.

### Prompt Optimization
llama-server has a mechanism enabled by default that caches prompts from previous requests. Prompt cache is effective up to the part that matches the previous prompt, allowing prompt processing to be skipped up to that part.

In other words, placing changes from the previous request at the end of the prompt enables fast response. To maximize the use of this mechanism, even when users type characters, the full source code remains unchanged, and instead, the latest source code reflecting the input is appended only to the bottom of the prompt as surrounding code.

### Edit History
Remembers the user's immediate previous edits and utilizes them in suggestions. Edits are categorized into add, delete, edit, rename, and copy to improve prediction accuracy.

This makes functions created immediately before more likely to be suggested, more accurately reflecting user intent.

### Symbols from Other Files
Uses symbols obtainable from VSCode's language providers and utilizes them in suggestions. These symbols allow LLM to understand class structures and improve the accuracy of member function suggestions.

## Privacy and Telemetry
All communication performed by Cotab is strictly limited to requests to the default endpoint `"http://localhost:8080/v1"` or to the LLM API specified by the user. No other external services or servers are contacted. This ensures maximum privacy and security.
- Communication is only made with the configured API
- No telemetry or usage data is ever sent
- User code or input is never shared with third parties
- No personal information is collected or stored
- This project is open-source, and all source code is available on GitHub  

With this policy, you can use Cotab with complete confidence.

## Contributing

## How to build

## License
Copyright (c) 2025 cotab
MIT License
