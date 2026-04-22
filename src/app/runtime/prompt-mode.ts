export type PromptMode = 'operational' | 'config' | 'shell' | 'login' | 'password' | 'unknown';

export function classifyPromptMode(output: string): PromptMode {
  const trimmed = output.trimEnd();
  if (!trimmed) return 'unknown';
  if (/[Pp]assword:\s*$/.test(trimmed)) return 'password';
  if (/login:\s*$/i.test(trimmed)) return 'login';
  if (/(?:\{[^}\n]+\}\s*\n)?[\w\-@.:]+%\s*$/.test(trimmed)) return 'shell';
  if (/(?:\{[^}\n]+\}\s*\n)?[\w\-@.:]+#\s*$/.test(trimmed)) return 'config';
  if (/(?:\{[^}\n]+\}\s*\n)?[\w\-@.:]+>\s*$/.test(trimmed)) return 'operational';
  return 'unknown';
}
