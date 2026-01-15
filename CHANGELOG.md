## 0.2.5 - 2026/01/15
- Update: getting started view.
## 0.2.4 - 2026/01/15
- Fix: Change llama.cpp archive from zip to tar.gz for macOS.
- Fix: Progress icon not hidden when trace icon is present.
- Update: Prompt cache checkpoint with LFM2 for performance improvement.
## 0.2.3 - 2026/01/05
- Update: Add using VS Code system inline suggestion display mode.
- Fix: Not hide inline suggestion bug.
- Fix: Not hide suggest widget bug when escape key is pressed.
## 0.2.2 - 2026/01/04
- Feature: Added Next Edit Jump feature.
- Update: Added preset models (LFM2-2.6B, Ministral-3-3B-2512, Qwen3-Coder (quantized)).
- Update: Enabled context cache for models using Cyclic KV Cache, such as LFM2.
- Update: Updated llama.cpp to stable version b7601.
- Fix: Fixed edit error occurring on the last line.
- Fix: Fixed insert not working at the current line.
- Fix: Fixed duplicate inline completion requests.
- Fix: Fixed local server connection prioritization issue.
- Fix: Changed Ubuntu llama.cpp archive from .zip to .tar.gz.
## 0.2.1 - 2025/12/31
- Support: 日本語, 忠文
- Fix: Server no stopping isue when multi VSCode insntace.
- Fix: Erase last line issue again.
## 0.2.0 - 2025/12/29
- Support: Qwen3-30B-A3B-Instruct and preset settings.
- Support: OpenAI Compatible API Key setting.
- Update: Plugin categories and keywords.
- Update: Remote model setting in getting started view.
- Update: Buisness chat / proofreading prompt.
- Fix: Poor completion prompt issue.
- Fix: kill process to only installed llama-server.
- Fix: Duplicate llama-server launch on auto-start issue.
- Fix: Edit history action type detection bug.
- Fix: Erase last line issue.
## 0.1.4 - 2025/12/08
- Fix: Slow performance bug since November 13, 2025.
- Update: Install stable version of llama.cpp (b7314)
## 0.1.3 - 2025/12/06
- Update: Install stable version of llama.cpp (b7010)
## 0.1.2 - 2025/12/01
- Update: improved error prompts and increased processing speed.
- Update: Translation prompt.
- Fix: The screen jittering when breakpoints are present.
- Fix: Text color not being applied in overlay.
- Fix: Merging multiple lines could break.
- Fix: Multiple prompts were not processed correctly.
## 0.1.0 - 2025/11/25
- Change: llama.cpp install path. (llama-cpp -> llama.cpp)
- Update: Significant quality improvement of coding, comment and translate.
- Support: Large file completion.
- Add: Use error problems for coding prompt.
- Add: no italic, temperature. Update: Comment Prompt
- Add: Disabled code summary.
- Fix: Flickering issue with overlay display
- Fix: Local server dose not stop when vscode is closed.
- Fix: Display icon of Server status bug
- Fix: Auto Start/Stop server bug
## 0.0.12 - 2025/11/09
- Support: Auto install llama.cpp on Ubuntu/MacOS
- Support: Light theme
- Add: Context size option on launch server
- Add: Yes/No when uninstall
- Update: Quick Setup view
- Update: Completion prompt
- Fix: Empty apiBaseURL bug.
## 0.0.11 - 2025/11/02
- Feat: Reject completion suggestion
- Update: Comment prompt
- Update: Prompt to better reflect edit history
## 0.0.10 - 2025/10/29
- Feat: First line accept
- Update: Quick Setup view
- Fix: Suggestion display bug
## 0.0.9 - 2025/10/26
- Add: Quick Setup view
- Fix: Inline suggestion issue
## 0.0.8 - 2025/10/24
- Feat: radio button to prompt selection
## 0.0.7 - 2025/10/16
- Automatically start up server when completion is requested
- Automatically stop server after idle timeout
- Yaml based prompt
- Fix issue where inline suggestion did not work
- Added ability to enable/disable completion per file extension
## 0.0.4 - 2025/10/07
- published vscode marketplace
## 0.0.1 - 2025/10/01
- Initial release
- alpha version
- Auto-completion
