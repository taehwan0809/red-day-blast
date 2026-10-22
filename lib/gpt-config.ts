export const DEFAULT_GPT_MODEL = 'gpt-6-luna';

export function getGptModel(configuredModel = process.env.GPT_MODEL) {
  return configuredModel?.trim() || DEFAULT_GPT_MODEL;
}
