export type LocalServerPreset =
    | 'VRAM-6GB Qwen3-4B'
    | 'VRAM-12GB Qwen3-Coder-30B:Q2'
    | 'VRAM-16GB Qwen3-Coder-30B:Q3'
    | 'VRAM-24GB Qwen3-Coder-30B'
    | 'Custom';

export const LOCAL_SERVER_PRESETS: LocalServerPreset[] = [
    'VRAM-6GB Qwen3-4B',
    'VRAM-12GB Qwen3-Coder-30B:Q2',
    'VRAM-16GB Qwen3-Coder-30B:Q3',
    'VRAM-24GB Qwen3-Coder-30B',
    'Custom'
];

export const DEFAULT_LOCAL_SERVER_PRESET: LocalServerPreset = 'VRAM-6GB Qwen3-4B';

export const localServerPresetArgs: Record<LocalServerPreset, string> = {
    'VRAM-6GB Qwen3-4B': '-hf unsloth/Qwen3-4B-Instruct-2507-GGUF --temp 0.7 --top-p 0.8 --top-k 20 --min-p 0.01 --repeat-penalty 1.05 --jinja -fa on -ngl 999 -kvu -ctk q8_0 -ctv q8_0',
    'VRAM-12GB Qwen3-Coder-30B:Q2': '-hf unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:Qwen3-Coder-30B-A3B-Instruct-UD-IQ2_M --temp 0.7 --top-p 0.8 --top-k 20 --min-p 0.01 --repeat-penalty 1.05 --jinja -fa on -ngl 999 -kvu -ctk q8_0 -ctv q8_0 --n-cpu-moe 5',
    'VRAM-16GB Qwen3-Coder-30B:Q3': '-hf unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:Qwen3-Coder-30B-A3B-Instruct-UD-Q3_K_XL --temp 0.7 --top-p 0.8 --top-k 20 --min-p 0.01 --repeat-penalty 1.05 --jinja -fa on -ngl 999 -kvu -ctk q8_0 -ctv q8_0',
    'VRAM-24GB Qwen3-Coder-30B': '-hf unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL --temp 0.7 --top-p 0.8 --top-k 20 --min-p 0.01 --repeat-penalty 1.05 --jinja -fa on -ngl 999 -kvu',
    'Custom': ''
};

export const DEFAULT_LOCAL_SERVER_CUSTOM_ARGS = localServerPresetArgs[DEFAULT_LOCAL_SERVER_PRESET];

export function isLocalServerPreset(value: unknown): value is LocalServerPreset {
    return LOCAL_SERVER_PRESETS.includes(value as LocalServerPreset);
}

