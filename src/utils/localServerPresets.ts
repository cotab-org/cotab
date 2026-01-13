interface LocalServerPresetConfig {
    readonly key: string;
    readonly visible: boolean;
    readonly args: string;
}

const LOCAL_SERVER_PRESET_CONFIGS: readonly LocalServerPresetConfig[] = [
    { key: 'Custom',                                                visible: true,  args: '' },
    { key: '----------------- Low VRAM Models -----------------',   visible: false, args: '' },
    { key: '[LFM2-2.6B:Q4] [VRAM 3GB] NotRecommended',              visible: false, args: '-hf LiquidAI/LFM2-2.6B-GGUF:LFM2-2.6B-Q4_K_M --temp 0.3 --top-p 0.9 --top-k 40 --min-p 0.15 --repeat-penalty 1.05 --jinja -fa on -ngl 999 -np 1 -b 512 -ctk q8_0 -ctv q8_0' },
//  { key: '[granite-4.0-micro:Q3] [VRAM 4GB] NotRecommended',      visible: false, args: '-hf unsloth/granite-4.0-micro-GGUF:granite-4.0-micro-UD-Q3_K_XL --temp 0.0 --top-p 1.0 --top-k 0 --min-p 0.01 --repeat-penalty 1.05 --jinja -fa on -ngl 999 -np 1 -b 512 -ctk q8_0 -ctv q8_0' },
    { key: '------------------- Fast Models -------------------',   visible: true,  args: '' },
    { key: '[Ministral-3-3B-2512:Q4] [VRAM 5GB] LowQuality',        visible: true,  args: '-hf unsloth/Ministral-3-3B-Instruct-2512-GGUF:Ministral-3-3B-Instruct-2512-UD-Q4_K_XL --temp 0.1 --top-p 0.95 --top-k 40 --min-p 0.01 --repeat-penalty 1.05 --jinja -fa on -ngl 999 -np 1 -b 512 -ctk q8_0 -ctv q8_0' },
//  { key: '[Qwen3-4B-2507:Q3] [VRAM 5GB] LowQuality-Fast',         visible: false, args: '-hf unsloth/Qwen3-4B-Instruct-2507-GGUF:Qwen3-4B-Instruct-2507-UD-IQ3_XXS --temp 0.7 --top-p 0.8 --top-k 20 --min-p 0.01 --repeat-penalty 1.05 --jinja -fa on -ngl 999 -np 1 -b 512 -ctk q8_0 -ctv q8_0' },
    { key: '[Qwen3-4B-2507:Q4] [VRAM 6GB] Balanced',                visible: true,  args: '-hf unsloth/Qwen3-4B-Instruct-2507-GGUF:Qwen3-4B-Instruct-2507-UD-Q4_K_XL --temp 0.7 --top-p 0.8 --top-k 20 --min-p 0.01 --repeat-penalty 1.05 --jinja -fa on -ngl 999 -np 1 -b 512 -ctk q8_0 -ctv q8_0' },
    { key: '------------- Quality(Low VRAM) Models -----------',    visible: true,  args: '' },
    { key: '[Qwen3-Coder-30B:Q1] [VRAM 11GB] Quality-Lite | Fast',  visible: true,  args: '-hf unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:Qwen3-Coder-30B-A3B-Instruct-UD-IQ1_S --temp 0.7 --top-p 0.8 --top-k 20 --min-p 0.01 --repeat-penalty 1.05 --jinja -fa on -ngl 999 -np 1 -b 512 -ctk q8_0 -ctv q8_0' },
    { key: '[Qwen3-Coder-30B:Q2] [VRAM 4GB] Quality | VerySlow',    visible: false, args: '-hf unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:Qwen3-Coder-30B-A3B-Instruct-UD-IQ2_M --temp 0.7 --top-p 0.8 --top-k 20 --min-p 0.01 --repeat-penalty 1.05 --jinja -fa on -ngl 999 -np 1 -b 512 --n-cpu-moe 48 -ctk q8_0 -ctv q8_0' },
    { key: '[Qwen3-Coder-30B:Q2] [VRAM 8GB] Quality | Slow',        visible: false, args: '-hf unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:Qwen3-Coder-30B-A3B-Instruct-UD-IQ2_M --temp 0.7 --top-p 0.8 --top-k 20 --min-p 0.01 --repeat-penalty 1.05 --jinja -fa on -ngl 999 -np 1 -b 512 --n-cpu-moe 35' },
    { key: '[Qwen3-Coder-30B:Q2] [VRAM 12GB] Quality | Medium',     visible: false, args: '-hf unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:Qwen3-Coder-30B-A3B-Instruct-UD-IQ2_M --temp 0.7 --top-p 0.8 --top-k 20 --min-p 0.01 --repeat-penalty 1.05 --jinja -fa on -ngl 999 -np 1 -b 512 --n-cpu-moe 13' },
    { key: '[Qwen3-Coder-30B:Q2] [VRAM 16GB] Quality | Fast',       visible: true,  args: '-hf unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:Qwen3-Coder-30B-A3B-Instruct-UD-IQ2_M --temp 0.7 --top-p 0.8 --top-k 20 --min-p 0.01 --repeat-penalty 1.05 --jinja -fa on -ngl 999 -np 1 -b 512' },
    { key: '---------------- Quality Models --------------',        visible: true,  args: '' },
    { key: '[Qwen3-Coder-30B:Q4] [VRAM 8GB] HighQuality | VerySlow',visible: false, args: '-hf unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL --temp 0.7 --top-p 0.8 --top-k 20 --min-p 0.01 --repeat-penalty 1.05 --jinja -fa on -ngl 999 -np 1 -b 512 --n-cpu-moe 40' },
    { key: '[Qwen3-Coder-30B:Q4] [VRAM 12GB] HighQuality | Slow',   visible: false, args: '-hf unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL --temp 0.7 --top-p 0.8 --top-k 20 --min-p 0.01 --repeat-penalty 1.05 --jinja -fa on -ngl 999 -np 1 -b 512 --n-cpu-moe 27' },
    { key: '[Qwen3-Coder-30B:Q4] [VRAM 16GB] HighQuality | Medium', visible: false, args: '-hf unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL --temp 0.7 --top-p 0.8 --top-k 20 --min-p 0.01 --repeat-penalty 1.05 --jinja -fa on -ngl 999 -np 1 -b 512 --n-cpu-moe 16' },
    { key: '[Qwen3-Coder-30B:Q4] [VRAM 24GB] HighQuality | Fast',   visible: true,  args: '-hf unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL --temp 0.7 --top-p 0.8 --top-k 20 --min-p 0.01 --repeat-penalty 1.05 --jinja -fa on -ngl 999 -np 1 -b 512' },
] as const;

export type LocalServerPreset = typeof LOCAL_SERVER_PRESET_CONFIGS[number]['key'];

export const LOCAL_SERVER_PRESETS: LocalServerPreset[] = LOCAL_SERVER_PRESET_CONFIGS.map(config => config.key);

export const DEFAULT_LOCAL_SERVER_PRESET: LocalServerPreset = '[Qwen3-4B-2507:Q4][VRAM 6GB] Balanced-Fast';

export const localServerPresetArgs: Record<LocalServerPreset, string> = Object.fromEntries(
    LOCAL_SERVER_PRESET_CONFIGS.map(config => [config.key, config.args])
) as Record<LocalServerPreset, string>;

export const localServerPresetVisibility: Record<LocalServerPreset, boolean> = Object.fromEntries(
    LOCAL_SERVER_PRESET_CONFIGS.map(config => [config.key, config.visible])
) as Record<LocalServerPreset, boolean>;

export const DEFAULT_LOCAL_SERVER_CUSTOM_ARGS = localServerPresetArgs[DEFAULT_LOCAL_SERVER_PRESET];

export function isLocalServerPreset(value: unknown): value is LocalServerPreset {
    return LOCAL_SERVER_PRESETS.includes(value as LocalServerPreset);
}

